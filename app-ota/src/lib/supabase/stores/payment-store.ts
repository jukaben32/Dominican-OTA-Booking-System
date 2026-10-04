import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PaymentError,
  VersionConflictError,
  type PaymentStore,
  type StoredPayment,
} from "../../services/payment-service";
import type { BookingPaymentStatus } from "../../payment-waterfall";
import type { PlanInstallment } from "../../payment-waterfall";

const UNIQUE_VIOLATION = "23505";

interface PaymentRow {
  id: string;
  booking_id: string;
  plan_id: string | null;
  amount_cents: number;
  currency: StoredPayment["currency"];
  status: StoredPayment["status"];
}

const PAYMENT_COLUMNS = "id, booking_id, plan_id, amount_cents, currency, status";

function toStored(row: PaymentRow): StoredPayment {
  return {
    id: row.id,
    bookingId: row.booking_id,
    planId: row.plan_id,
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status,
  };
}

// Implementación de PaymentStore sobre Supabase. Es una capa FINA: la lógica está en payment-service.ts
// (probado con un almacén falso) y la parte delicada del guardado está en la función SQL apply_payment
// (probada con PGlite en src/db/schema.test.ts).
export function createSupabasePaymentStore(db: SupabaseClient): PaymentStore {
  async function findByKey(key: string): Promise<StoredPayment | null> {
    const { data, error } = await db
      .from("payments")
      .select(PAYMENT_COLUMNS)
      .eq("idempotency_key", key)
      .maybeSingle();
    if (error) throw new Error(`No se pudo leer el pago: ${error.message}`);
    return data ? toStored(data as PaymentRow) : null;
  }

  return {
    findPaymentByKey: findByKey,

    async getPayment(paymentId) {
      const { data, error } = await db.from("payments").select(PAYMENT_COLUMNS).eq("id", paymentId).maybeSingle();
      if (error) throw new Error(`No se pudo leer el pago: ${error.message}`);
      return data ? toStored(data as PaymentRow) : null;
    },

    async insertPayment(payment) {
      const { data, error } = await db
        .from("payments")
        .insert({
          booking_id: payment.bookingId,
          plan_id: payment.planId,
          amount_cents: payment.amountCents,
          currency: payment.currency,
          method: payment.method,
          idempotency_key: payment.idempotencyKey,
          gateway_reference: payment.gatewayReference ?? null,
          bank_reference: payment.bankReference ?? null,
          proof_path: payment.proofPath ?? null,
          created_by: payment.createdBy ?? null,
        })
        .select(PAYMENT_COLUMNS)
        .single();

      if (error?.code === UNIQUE_VIOLATION) {
        // Otro proceso lo insertó justo antes: usamos el existente
        const existente = await findByKey(payment.idempotencyKey);
        if (existente) return existente;
        if (error.message.includes("payments_bank_reference_unique")) {
          throw new PaymentError("Esa referencia bancaria ya está registrada en otro pago vigente");
        }
      }
      if (error || !data) throw new Error(`No se pudo registrar el pago: ${error?.message ?? "sin datos"}`);
      return toStored(data as PaymentRow);
    },

    async findPlanIdForBooking(bookingId) {
      const { data, error } = await db
        .from("payment_plans")
        .select("id")
        .eq("booking_id", bookingId)
        .in("status", ["ACTIVE", "OVERDUE"])
        .maybeSingle();
      if (error) throw new Error(`No se pudo leer el plan: ${error.message}`);
      return data?.id ?? null;
    },

    async loadPlan(planId) {
      const { data: plan, error } = await db
        .from("payment_plans")
        .select("id, version")
        .eq("id", planId)
        .maybeSingle();
      if (error) throw new Error(`No se pudo leer el plan: ${error.message}`);
      if (!plan) return null;

      const { data: cuotas, error: errorCuotas } = await db
        .from("installments")
        .select("sequence, amount_cents, paid_cents, due_date, status")
        .eq("plan_id", planId)
        .order("sequence");
      if (errorCuotas) throw new Error(`No se pudieron leer las cuotas: ${errorCuotas.message}`);

      return {
        planId: plan.id as string,
        version: plan.version as number,
        installments: (cuotas ?? []).map(
          (c): PlanInstallment => ({
            sequence: c.sequence,
            amountCents: c.amount_cents,
            paidCents: c.paid_cents,
            dueDate: c.due_date,
            status: c.status,
          }),
        ),
      };
    },

    async applyPayment(args) {
      const { data, error } = await db.rpc("apply_payment", {
        p_payment_id: args.paymentId,
        p_expected_version: args.expectedVersion,
        p_installments: args.installments,
        p_plan_status: args.planStatus,
        p_actor: args.actorId,
      });
      if (error) throw traducirError(error.message);

      const r = data as {
        result: "APPLIED" | "ALREADY_APPLIED";
        applied_cents: number;
        unapplied_cents: number;
        booking_status?: BookingPaymentStatus;
      };
      return {
        result: r.result,
        appliedCents: r.applied_cents,
        unappliedCents: r.unapplied_cents,
        bookingStatus: r.booking_status ?? null,
      };
    },
  };
}

// Convierte los errores de la función SQL en mensajes claros para el agente.
// El conflicto de versión es especial: el servicio lo reintenta solo.
function traducirError(mensaje: string): Error {
  if (mensaje.includes("VERSION_CONFLICT")) return new VersionConflictError();
  const conocidos: [string, string][] = [
    ["MONEDA_NO_COINCIDE", "La moneda del pago no coincide con la de la reserva"],
    ["RESERVA_CERRADA", "La reserva está cancelada, vencida o reembolsada: concilia este pago a mano"],
    ["PLAN_NO_ACTIVO", "El plan de pago ya no está activo (mora grave o cancelado): decide cómo tratar este pago"],
    ["MONTOS_NO_CUADRAN", "Los montos del pago no cuadran con las cuotas"],
    ["CUOTA_NO_EXISTE", "Una cuota del plan no existe"],
    ["SOBREPAGO", "El pago superaría el total de la reserva"],
    ["PAGO_NO_APLICABLE", "El pago ya no está pendiente de verificación"],
  ];
  const encontrado = conocidos.find(([codigo]) => mensaje.includes(codigo));
  return encontrado ? new PaymentError(encontrado[1]) : new Error(`No se pudo aplicar el pago: ${mensaje}`);
}
