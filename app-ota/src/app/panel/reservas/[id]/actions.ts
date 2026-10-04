"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/components/action-form";
import { requireStaff } from "@/lib/auth";
import { todayInSantoDomingo } from "@/lib/dates";
import { getOnlineEnv } from "@/lib/env";
import { logError } from "@/lib/logger";
import { deriveAccessToken } from "@/lib/online/access-token";
import { readProofFromForm } from "@/lib/proofs";
import { parseMoneyInput } from "@/lib/money";
import { PaymentPlanError } from "@/lib/payment-plan";
import { createPlanForBooking } from "@/lib/services/plan-service";
import { PaymentError, registerPayment } from "@/lib/services/payment-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { removeProof, uploadProof } from "@/lib/supabase/proof-storage";
import { createSupabasePaymentStore } from "@/lib/supabase/stores/payment-store";
import { createSupabasePlanStore } from "@/lib/supabase/stores/plan-store";
import { createClient } from "@/lib/supabase/server";

const OPEN_FOR_PAYMENT = new Set(["QUOTED", "ON_HOLD", "PENDING_PAYMENT", "PARTIALLY_PAID"]);
const PNR = /^[A-Z0-9]{5,8}$/;
const LINK_STATUSES = new Set(["QUOTED", "ON_HOLD", "PENDING_PAYMENT", "PARTIALLY_PAID", "PAID", "TICKETED"]);
const CHECK_VIOLATION = "23514";

const idSchema = z.uuid();

function volver(id: string): never {
  revalidatePath(`/panel/reservas/${id}`);
  redirect(`/panel/reservas/${id}`);
}

// ---------------------------------------------------------------------
// Crear el plan de apartado (sin intereses)
// ---------------------------------------------------------------------
const planSchema = z.object({
  bookingId: idSchema,
  downPaymentPercent: z.coerce.number().int().min(20).max(50),
  installmentCount: z.coerce.number().int().min(1).max(12),
  frequency: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY"]),
});

export async function createPlanAction(_anterior: ActionState, formData: FormData): Promise<ActionState> {
  const usuario = await requireStaff();
  const datos = planSchema.safeParse({
    bookingId: formData.get("bookingId"),
    downPaymentPercent: formData.get("downPaymentPercent"),
    installmentCount: formData.get("installmentCount"),
    frequency: formData.get("frequency"),
  });
  if (!datos.success) return { error: "Revisa el abono inicial (20 a 50 %), las cuotas (1 a 12) y la frecuencia" };

  try {
    await createPlanForBooking(createSupabasePlanStore(createAdminClient()), {
      ...datos.data,
      today: todayInSantoDomingo(),
      actorId: usuario.id,
    });
  } catch (error) {
    // Los PaymentPlanError son reglas del negocio con mensaje claro; el resto es un fallo técnico
    if (error instanceof PaymentPlanError) return { error: error.message };
    logError("panel.create_plan.failed", error, { bookingId: datos.data.bookingId });
    return { error: "No se pudo crear el plan. Inténtalo de nuevo; si persiste, avisa a un administrador" };
  }
  volver(datos.data.bookingId);
}

// ---------------------------------------------------------------------
// Registrar un pago por transferencia o efectivo (queda pendiente de verificación)
// ---------------------------------------------------------------------
const pagoSchema = z.object({
  bookingId: idSchema,
  formToken: z.uuid(), // identifica ESTE formulario: si se envía dos veces, el pago no se duplica
  amount: z.string(),
  method: z.enum(["TRANSFER", "CASH"]),
  bankReference: z.string().trim().max(60),
});

export async function registerManualPaymentAction(_anterior: ActionState, formData: FormData): Promise<ActionState> {
  const usuario = await requireStaff();
  const datos = pagoSchema.safeParse({
    bookingId: formData.get("bookingId"),
    formToken: formData.get("formToken"),
    amount: formData.get("amount") ?? "",
    method: formData.get("method"),
    bankReference: formData.get("bankReference") ?? "",
  });
  if (!datos.success) return { error: "Revisa los datos del pago" };

  const monto = parseMoneyInput(datos.data.amount);
  if (monto === null || monto <= 0) return { error: "El monto no es válido (ejemplo: 250.00)" };

  // Comprobante (foto o PDF): opcional, pero una transferencia necesita comprobante o referencia
  const lectura = await readProofFromForm(formData.get("proof"));
  if (!lectura.ok) return { error: lectura.error };
  if (datos.data.method === "TRANSFER" && !lectura.proof && !datos.data.bankReference) {
    return { error: "Una transferencia necesita el comprobante o la referencia bancaria" };
  }

  const db = createAdminClient();
  let rutaComprobante: string | undefined;
  try {
    const { data: reserva, error } = await db
      .from("bookings")
      .select("currency, status")
      .eq("id", datos.data.bookingId)
      .maybeSingle();
    if (error) throw error;
    if (!reserva) return { error: "La reserva no existe" };
    if (!OPEN_FOR_PAYMENT.has(reserva.status)) return { error: "Esta reserva ya no admite pagos" };

    if (lectura.proof) rutaComprobante = await uploadProof(db, datos.data.bookingId, lectura.proof);

    const { created } = await registerPayment(createSupabasePaymentStore(db), {
      bookingId: datos.data.bookingId,
      amountCents: monto,
      // La moneda sale de la RESERVA, nunca del formulario: así no se puede registrar pesos como dólares
      currency: reserva.currency,
      method: datos.data.method,
      idempotencyKey: `manual:${datos.data.formToken}`,
      bankReference: datos.data.bankReference || undefined,
      proofPath: rutaComprobante,
      createdBy: usuario.id,
    });
    // Reenvío del mismo formulario: el pago ya existía, así que el archivo recién subido sobra
    if (!created && rutaComprobante) await removeProof(db, rutaComprobante);
  } catch (error) {
    if (rutaComprobante) await removeProof(db, rutaComprobante); // no dejar archivos huérfanos
    if (error instanceof PaymentError) return { error: error.message };
    logError("panel.register_payment.failed", error, { bookingId: datos.data.bookingId });
    return { error: "No se pudo registrar el pago. Inténtalo de nuevo" };
  }
  volver(datos.data.bookingId);
}

// ---------------------------------------------------------------------
// Activar el enlace privado del cliente (para que vea su reserva, pague con tarjeta o suba su comprobante)
// ---------------------------------------------------------------------
export async function enableCustomerLinkAction(formData: FormData): Promise<void> {
  const usuario = await requireStaff();
  const id = idSchema.safeParse(formData.get("bookingId"));
  if (!id.success) redirect("/panel/reservas");

  const db = createAdminClient();
  const { data: reserva, error } = await db
    .from("bookings")
    .select("form_token, departure_id, status, access_token_hash")
    .eq("id", id.data)
    .maybeSingle();
  if (error) {
    logError("panel.customer_link_failed", error, { bookingId: id.data });
    volver(id.data);
  }
  // Solo reservas de tour (tienen salida) y con identificador de formulario; las ya activadas se dejan como están
  if (reserva?.form_token && reserva.departure_id && !reserva.access_token_hash && LINK_STATUSES.has(reserva.status)) {
    const secreto = getOnlineEnv().ONLINE_LINK_SECRET;
    const { hash } = deriveAccessToken(String(reserva.form_token), secreto);
    const { error: errorUpdate } = await db.from("bookings").update({ access_token_hash: hash }).eq("id", id.data).is("access_token_hash", null);
    if (errorUpdate) {
      logError("panel.customer_link_failed", errorUpdate, { bookingId: id.data });
    } else {
      const { error: errorAuditoria } = await db.from("audit_log").insert({
        actor_id: usuario.id, action: "CUSTOMER_LINK_ENABLED", entity: "bookings", entity_id: id.data, details: {},
      });
      if (errorAuditoria) logError("panel.customer_link.audit_failed", errorAuditoria, { bookingId: id.data });
    }
  }
  volver(id.data);
}

// ---------------------------------------------------------------------
// Emitir el boleto (solo con el 100 % pagado)
// ---------------------------------------------------------------------
const emisionSchema = z.object({
  bookingId: idSchema,
  pnr: z.string().trim().toUpperCase().regex(PNR, "El localizador debe tener de 5 a 8 letras o números"),
});

export async function issueTicketAction(_anterior: ActionState, formData: FormData): Promise<ActionState> {
  const usuario = await requireStaff();
  const datos = emisionSchema.safeParse({ bookingId: formData.get("bookingId"), pnr: formData.get("pnr") ?? "" });
  if (!datos.success) return { error: datos.error.issues[0]?.message ?? "Revisa el localizador" };

  const db = await createClient(); // con la sesión del agente
  const { data, error } = await db
    .from("bookings")
    .update({ status: "TICKETED", pnr: datos.data.pnr })
    .eq("id", datos.data.bookingId)
    .eq("status", "PAID") // solo se emite lo que está pagado
    .select("id");

  if (error) {
    // La base de datos también lo exige: una reserva TICKETED requiere el 100 % cobrado
    if (error.code === CHECK_VIOLATION) return { error: "Solo se puede emitir con el 100 % pagado" };
    logError("panel.issue_ticket.failed", error, { bookingId: datos.data.bookingId });
    return { error: "No se pudo marcar como emitida. Inténtalo de nuevo" };
  }
  if (!data || data.length === 0) return { error: "La reserva debe estar pagada al 100 % para poder emitirla" };

  const { error: errorAuditoria } = await createAdminClient().from("audit_log").insert({
    actor_id: usuario.id,
    action: "BOOKING_TICKETED",
    entity: "bookings",
    entity_id: datos.data.bookingId,
    details: { pnr: datos.data.pnr },
  });
  if (errorAuditoria) logError("panel.issue_ticket.audit_failed", errorAuditoria, { bookingId: datos.data.bookingId });

  volver(datos.data.bookingId);
}
