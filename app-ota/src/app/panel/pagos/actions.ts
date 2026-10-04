"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canApprovePayment } from "@/lib/approval-policy";
import { requireStaff } from "@/lib/auth";
import { todayInSantoDomingo } from "@/lib/dates";
import { logError } from "@/lib/logger";
import { readProofFromForm } from "@/lib/proofs";
import { approvePayment, PaymentError } from "@/lib/services/payment-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { removeProof, uploadProof } from "@/lib/supabase/proof-storage";
import { createSupabasePaymentStore } from "@/lib/supabase/stores/payment-store";

const idSchema = z.object({ paymentId: z.uuid() });
const rejectSchema = idSchema.extend({ reason: z.string().trim().min(3).max(300) });

const VOLVER = "/panel/pagos";

// Aprueba una transferencia/pago verificado: aplica el dinero a las cuotas y la reserva
export async function approvePaymentAction(formData: FormData): Promise<void> {
  const usuario = await requireStaff(); // la acción vuelve a verificar el rol: no confía en la pantalla
  const datos = idSchema.safeParse({ paymentId: formData.get("paymentId") });
  if (!datos.success) redirect(`${VOLVER}?error=datos`);

  const almacen = createSupabasePaymentStore(createAdminClient());
  let mensajeError: string | null = null;
  try {
    // Separación de funciones: un agente solo aprueba hasta cierto monto; lo demás, un administrador
    const pago = await almacen.getPayment(datos.data.paymentId);
    if (!pago) throw new PaymentError("El pago no existe");
    if (!canApprovePayment(usuario.role, pago.amountCents, pago.currency)) {
      mensajeError = "limite";
    } else {
      await approvePayment(almacen, datos.data.paymentId, { actorId: usuario.id, today: todayInSantoDomingo() });
    }
  } catch (error) {
    logError("panel.approve_payment.failed", error, { paymentId: datos.data.paymentId });
    mensajeError = error instanceof PaymentError ? "pago" : "interno";
  }

  // redirect() lanza una excepción especial: por eso va fuera del try/catch
  if (mensajeError) redirect(`${VOLVER}?error=${mensajeError}`);
  revalidatePath("/panel", "layout");
  redirect(`${VOLVER}?ok=aprobado`);
}

// Adjunta el comprobante a un pago pendiente que se registró sin él
export async function attachProofAction(formData: FormData): Promise<void> {
  const usuario = await requireStaff();
  const datos = idSchema.safeParse({ paymentId: formData.get("paymentId") });
  if (!datos.success) redirect(`${VOLVER}?error=datos`);

  const lectura = await readProofFromForm(formData.get("proof"));
  if (!lectura.ok || !lectura.proof) redirect(`${VOLVER}?error=archivo`);

  const db = createAdminClient();
  let ruta: string | null = null;
  let mensajeError: string | null = null;
  try {
    const { data: pago, error } = await db
      .from("payments")
      .select("booking_id")
      .eq("id", datos.data.paymentId)
      .eq("status", "PENDING_VERIFICATION")
      .is("proof_path", null)
      .maybeSingle();
    if (error) throw error;
    if (!pago) {
      mensajeError = "pago";
    } else {
      ruta = await uploadProof(db, pago.booking_id as string, lectura.proof);
      // Condiciones en el UPDATE: si alguien más adjuntó o resolvió el pago mientras tanto, no se pisa
      const { data: filas, error: errorUpdate } = await db
        .from("payments")
        .update({ proof_path: ruta })
        .eq("id", datos.data.paymentId)
        .eq("status", "PENDING_VERIFICATION")
        .is("proof_path", null)
        .select("id");
      if (errorUpdate) throw errorUpdate;
      if (!filas || filas.length === 0) {
        await removeProof(db, ruta);
        mensajeError = "pago";
      } else {
        const { error: errorAuditoria } = await db.from("audit_log").insert({
          actor_id: usuario.id,
          action: "PAYMENT_PROOF_ATTACHED",
          entity: "payments",
          entity_id: datos.data.paymentId,
          details: {},
        });
        if (errorAuditoria) logError("panel.attach_proof.audit_failed", errorAuditoria, { paymentId: datos.data.paymentId });
      }
    }
  } catch (error) {
    if (ruta) await removeProof(db, ruta);
    logError("panel.attach_proof.failed", error, { paymentId: datos.data.paymentId });
    mensajeError = "interno";
  }

  if (mensajeError) redirect(`${VOLVER}?error=${mensajeError}`);
  revalidatePath("/panel", "layout");
  redirect(`${VOLVER}?ok=comprobante`);
}

// Rechaza un comprobante (queda el motivo y quién lo rechazó)
export async function rejectPaymentAction(formData: FormData): Promise<void> {
  const usuario = await requireStaff();
  const datos = rejectSchema.safeParse({
    paymentId: formData.get("paymentId"),
    reason: formData.get("reason"),
  });
  if (!datos.success) redirect(`${VOLVER}?error=motivo`);

  const db = createAdminClient();
  // Condición "status = PENDING_VERIFICATION": un pago ya aprobado no se puede rechazar por error
  const { data, error } = await db
    .from("payments")
    .update({
      status: "REJECTED",
      rejection_reason: datos.data.reason,
      verified_by: usuario.id,
      verified_at: new Date().toISOString(),
    })
    .eq("id", datos.data.paymentId)
    .eq("status", "PENDING_VERIFICATION")
    .select("id");

  if (error) {
    logError("panel.reject_payment.failed", error, { paymentId: datos.data.paymentId });
    redirect(`${VOLVER}?error=interno`);
  }
  if (!data || data.length === 0) redirect(`${VOLVER}?error=pago`);

  const { error: errorAuditoria } = await db.from("audit_log").insert({
    actor_id: usuario.id,
    action: "PAYMENT_REJECTED",
    entity: "payments",
    entity_id: datos.data.paymentId,
    details: { reason: datos.data.reason },
  });
  if (errorAuditoria) logError("panel.reject_payment.audit_failed", errorAuditoria, { paymentId: datos.data.paymentId });

  revalidatePath("/panel", "layout");
  redirect(`${VOLVER}?ok=rechazado`);
}
