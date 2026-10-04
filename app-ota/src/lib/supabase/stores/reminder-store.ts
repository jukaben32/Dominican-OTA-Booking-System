import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isClaimRetryable, type OpenPlan, type ReminderStore } from "../../services/reminder-service";

const UNIQUE_VIOLATION = "23505";
const PAGE_SIZE = 500;
const CLOSED_BOOKING_STATUSES = new Set(["CANCELLED", "EXPIRED", "REFUNDED"]);

// Validamos lo que devuelve la base antes de usarlo: si cambia la forma, falla fuerte y claro
const planRowSchema = z.object({
  id: z.string(),
  status: z.enum(["ACTIVE", "OVERDUE"]),
  booking: z.object({
    id: z.string(),
    code: z.string(),
    currency: z.enum(["USD", "DOP"]),
    status: z.string(),
    customer: z.object({
      id: z.string(),
      full_name: z.string(),
      phone_e164: z.string(),
      whatsapp_opt_in_at: z.string().nullable(),
    }),
  }),
  installments: z.array(
    z.object({
      sequence: z.number(),
      amount_cents: z.number(),
      paid_cents: z.number(),
      due_date: z.string(),
      status: z.enum(["PENDING", "PAID", "PARTIAL", "OVERDUE", "WAIVED"]),
    }),
  ),
});

export function createSupabaseReminderStore(db: SupabaseClient): ReminderStore {
  return {
    async listOpenPlans() {
      // PostgREST devuelve como máximo 1000 filas por consulta: leemos por páginas hasta agotar los planes
      const filas: unknown[] = [];
      for (let desde = 0; ; desde += PAGE_SIZE) {
        const { data, error } = await db
          .from("payment_plans")
          .select(
            `id, status,
             booking:bookings!inner(id, code, currency, status,
               customer:customers!inner(id, full_name, phone_e164, whatsapp_opt_in_at)),
             installments(sequence, amount_cents, paid_cents, due_date, status)`,
          )
          .in("status", ["ACTIVE", "OVERDUE"])
          .order("id") // orden estable: sin él, las páginas podrían repetir o saltarse planes
          .range(desde, desde + PAGE_SIZE - 1);
        if (error) throw new Error(`No se pudieron leer los planes: ${error.message}`);
        filas.push(...(data ?? []));
        if ((data?.length ?? 0) < PAGE_SIZE) break;
      }

      return z
        .array(planRowSchema)
        .parse(filas)
        .filter((p) => !CLOSED_BOOKING_STATUSES.has(p.booking.status))
        .map(
          (p): OpenPlan => ({
            planId: p.id,
            planStatus: p.status,
            bookingId: p.booking.id,
            bookingCode: p.booking.code,
            currency: p.booking.currency,
            customerId: p.booking.customer.id,
            customerName: p.booking.customer.full_name,
            customerPhone: p.booking.customer.phone_e164,
            whatsappOptIn: p.booking.customer.whatsapp_opt_in_at !== null,
            installments: p.installments.map((c) => ({
              sequence: c.sequence,
              amountCents: c.amount_cents,
              paidCents: c.paid_cents,
              dueDate: c.due_date,
              status: c.status,
            })),
          }),
        );
    },

    async saveInstallmentStatuses(planId, items, plan) {
      // Condición "status = from": si mientras el cron trabajaba entró un pago y la cuota ya es PAID, no se pisa
      for (const item of items) {
        const { error } = await db
          .from("installments")
          .update({ status: item.to })
          .eq("plan_id", planId)
          .eq("sequence", item.sequence)
          .eq("status", item.from);
        if (error) throw new Error(`No se pudo actualizar la cuota: ${error.message}`);
      }
      // El plan solo cambia entre ACTIVE y OVERDUE; uno en mora grave, cancelado o completado no se toca
      const { error } = await db
        .from("payment_plans")
        .update({ status: plan.to })
        .eq("id", planId)
        .eq("status", plan.from)
        .in("status", ["ACTIVE", "OVERDUE"]);
      if (error) throw new Error(`No se pudo actualizar el plan: ${error.message}`);
    },

    async markPlanDefaulted(planId) {
      const { error } = await db
        .from("payment_plans")
        .update({ status: "DEFAULTED" })
        .eq("id", planId)
        .in("status", ["ACTIVE", "OVERDUE"]);
      if (error) throw new Error(`No se pudo marcar el plan en mora: ${error.message}`);
      const { error: errorAuditoria } = await db.from("audit_log").insert({
        action: "PLAN_DEFAULTED",
        entity: "payment_plans",
        entity_id: planId,
        details: { by: "cron" },
      });
      if (errorAuditoria) throw new Error(`No se pudo escribir la auditoría: ${errorAuditoria.message}`);
    },

    async claimMessage({ dedupeKey, customerId, bookingId, templateName }) {
      const { data, error } = await db
        .from("whatsapp_messages")
        .insert({
          customer_id: customerId,
          booking_id: bookingId,
          direction: "OUT",
          template_name: templateName,
          dedupe_key: dedupeKey,
          status: "QUEUED",
        })
        .select("id")
        .single();

      if (!error && data) return { id: data.id as string, shouldSend: true };
      if (error?.code !== UNIQUE_VIOLATION) {
        throw new Error(`No se pudo reservar el mensaje: ${error?.message ?? "sin datos"}`);
      }

      // Ya existía: se reintenta solo si falló o quedó "en cola" tanto tiempo que el proceso murió
      const { data: previo, error: errorPrevio } = await db
        .from("whatsapp_messages")
        .select("id, status, created_at")
        .eq("dedupe_key", dedupeKey)
        .single();
      if (errorPrevio || !previo) throw new Error("No se pudo leer el mensaje previo");
      if (!isClaimRetryable(previo.status, new Date(previo.created_at).getTime(), Date.now())) {
        return { id: previo.id as string, shouldSend: false };
      }

      // Condición "status = el que vimos": si dos procesos reintentan a la vez, solo uno gana.
      // created_at se renueva para que el mensaje reintentado no se considere atascado de inmediato.
      const { data: reclamado } = await db
        .from("whatsapp_messages")
        .update({ status: "QUEUED", error: null, created_at: new Date().toISOString() })
        .eq("id", previo.id)
        .eq("status", previo.status)
        .select("id");
      return { id: previo.id as string, shouldSend: (reclamado?.length ?? 0) > 0 };
    },

    async finishMessage(messageId, result) {
      const { error } = await db
        .from("whatsapp_messages")
        .update({
          status: result.status,
          provider_message_id: result.providerMessageId ?? null,
          error: result.error ?? null,
        })
        .eq("id", messageId);
      if (error) throw new Error(`No se pudo guardar el resultado del mensaje: ${error.message}`);
    },
  };
}
