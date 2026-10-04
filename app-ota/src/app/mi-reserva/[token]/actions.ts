"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/components/action-form";
import { logError } from "@/lib/logger";
import { parseMoneyInput } from "@/lib/money";
import { attemptKey, clientIp, hashAccessToken, isValidTokenFormat } from "@/lib/online/access-token";
import { readProofFromForm } from "@/lib/proofs";
import { PaymentError, registerPayment } from "@/lib/services/payment-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOnlineBookingByToken, takeAttempt } from "@/lib/supabase/online-repo";
import { createSupabasePaymentStore } from "@/lib/supabase/stores/payment-store";
import { removeProof, uploadProof } from "@/lib/supabase/proof-storage";

const MAX_ATTEMPTS_PER_HOUR = 8;
const MAX_PENDING_PAYMENTS = 3; // un cliente no puede llenar la cola de verificación con envíos
const OPEN_STATUSES = new Set(["QUOTED", "ON_HOLD", "PENDING_PAYMENT", "PARTIALLY_PAID"]);

const schema = z.object({
  token: z.string(),
  formToken: z.uuid(),
  amount: z.string().max(20),
  bankReference: z.string().trim().max(60),
});

// El cliente avisa que ya transfirió: queda PENDIENTE y un agente lo aprueba tras ver el dinero en el banco.
// El enlace secreto es la única credencial, así que todo se limita por intentos y se valida como entrada pública.
export async function submitOnlineProofAction(_anterior: ActionState, formData: FormData): Promise<ActionState> {
  const datos = schema.safeParse({
    token: formData.get("token"),
    formToken: formData.get("formToken"),
    amount: formData.get("amount") ?? "",
    bankReference: formData.get("bankReference") ?? "",
  });
  if (!datos.success || !isValidTokenFormat(datos.data.token)) return { error: "Revisa los datos del pago" };
  const d = datos.data;

  const monto = parseMoneyInput(d.amount);
  if (monto === null || monto <= 0) return { error: "El monto no es válido (ejemplo: 250.00)" };

  const db = createAdminClient();
  let ruta: string | undefined;
  try {
    // 1) Límite por IP (también frena enlaces inventados) y 2) se comprueba que la reserva exista ANTES de leer el archivo
    const ip = clientIp(await headers());
    if (ip && !(await takeAttempt(db, attemptKey("comprobante-ip", ip), MAX_ATTEMPTS_PER_HOUR, 60))) {
      return { error: "Demasiados intentos. Espera un rato o escríbenos por WhatsApp" };
    }
    const reserva = await getOnlineBookingByToken(db, d.token);
    if (!reserva) return { error: "No encontramos tu reserva" };
    // 3) Límite por enlace, solo para enlaces reales
    if (!(await takeAttempt(db, attemptKey("comprobante", hashAccessToken(d.token)), MAX_ATTEMPTS_PER_HOUR, 60))) {
      return { error: "Demasiados intentos. Espera un rato o escríbenos por WhatsApp" };
    }
    if (!OPEN_STATUSES.has(reserva.status)) return { error: "Esta reserva ya no admite pagos" };
    if (reserva.status === "PENDING_PAYMENT" && reserva.hold_expires_at && new Date(reserva.hold_expires_at) < new Date()) {
      return { error: "El plazo para pagar venció. Escríbenos por WhatsApp y vemos si aún hay cupo" };
    }
    const pendientes = reserva.payments.filter((p) => p.status === "PENDING_VERIFICATION");
    if (pendientes.length >= MAX_PENDING_PAYMENTS) {
      return { error: "Ya enviaste varios pagos que estamos verificando. Espera a que los confirmemos" };
    }
    // Lo que falta descuenta también lo que ya enviaste y está en revisión
    const enRevision = pendientes.reduce((suma, p) => suma + p.amount_cents, 0);
    if (monto > reserva.total_cents - reserva.paid_cents - enRevision) {
      return { error: "El monto es mayor que lo que falta por pagar (contando lo que ya enviaste)" };
    }

    // Recién ahora se lee el archivo (hasta 5 MB)
    const lectura = await readProofFromForm(formData.get("proof"));
    if (!lectura.ok) return { error: lectura.error };
    if (!lectura.proof && !d.bankReference) return { error: "Adjunta el comprobante o escribe la referencia de la transferencia" };
    if (lectura.proof) ruta = await uploadProof(db, reserva.id, lectura.proof);

    const { created } = await registerPayment(createSupabasePaymentStore(db), {
      bookingId: reserva.id,
      amountCents: monto,
      currency: reserva.currency, // la moneda sale de la reserva, nunca del formulario
      method: "TRANSFER",
      idempotencyKey: `online:${d.formToken}`,
      bankReference: d.bankReference || undefined,
      proofPath: ruta,
    });
    if (!created && ruta) await removeProof(db, ruta); // reenvío del mismo formulario
  } catch (error) {
    if (ruta) await removeProof(db, ruta);
    if (error instanceof PaymentError) return { error: error.message };
    logError("online.proof_failed", error);
    return { error: "No se pudo registrar el pago. Inténtalo de nuevo o escríbenos por WhatsApp" };
  }

  revalidatePath(`/mi-reserva/${d.token}`);
  redirect(`/mi-reserva/${d.token}?enviado=1`);
}
