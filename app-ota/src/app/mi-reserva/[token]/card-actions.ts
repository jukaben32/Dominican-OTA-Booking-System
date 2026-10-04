"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { logError } from "@/lib/logger";
import { attemptKey, clientIp, hashAccessToken, isValidTokenFormat } from "@/lib/online/access-token";
import type { AzulPaymentForm } from "@/lib/payments/azul";
import { getAzulSetup } from "@/lib/payments/azul-config";
import { startCardPayment } from "@/lib/services/azul-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOnlineBookingByToken, takeAttempt } from "@/lib/supabase/online-repo";
import { createSupabaseAzulStore } from "@/lib/supabase/stores/azul-store";

export interface CardState {
  error?: string;
  form?: AzulPaymentForm; // formulario firmado que el navegador envía a Azul
}

const OPEN_STATUSES = new Set(["QUOTED", "ON_HOLD", "PENDING_PAYMENT", "PARTIALLY_PAID"]);
const MAX_ATTEMPTS_PER_HOUR = 8;
const schema = z.object({ token: z.string() });

// Inicia un pago con tarjeta por lo que falta de la reserva. Solo registra el intento y devuelve el formulario
// firmado: el dinero se aplica únicamente cuando Azul vuelve con una respuesta cuya firma verificamos.
export async function startCardPaymentAction(_anterior: CardState, formData: FormData): Promise<CardState> {
  const datos = schema.safeParse({ token: formData.get("token") });
  if (!datos.success || !isValidTokenFormat(datos.data.token)) return { error: "No encontramos tu reserva" };
  const { token } = datos.data;

  const setup = getAzulSetup();
  if (!setup) return { error: "El pago con tarjeta todavía no está disponible. Paga por transferencia o escríbenos por WhatsApp" };

  const db = createAdminClient();
  try {
    const ip = clientIp(await headers());
    if (ip && !(await takeAttempt(db, attemptKey("tarjeta-ip", ip), MAX_ATTEMPTS_PER_HOUR, 60))) {
      return { error: "Demasiados intentos. Espera un rato o escríbenos por WhatsApp" };
    }
    const reserva = await getOnlineBookingByToken(db, token);
    if (!reserva) return { error: "No encontramos tu reserva" };
    if (!(await takeAttempt(db, attemptKey("tarjeta", hashAccessToken(token)), MAX_ATTEMPTS_PER_HOUR, 60))) {
      return { error: "Demasiados intentos. Espera un rato o escríbenos por WhatsApp" };
    }
    if (!OPEN_STATUSES.has(reserva.status)) return { error: "Esta reserva ya no admite pagos" };
    if (reserva.status === "PENDING_PAYMENT" && reserva.hold_expires_at && new Date(reserva.hold_expires_at) < new Date()) {
      return { error: "El plazo para pagar venció. Escríbenos por WhatsApp y vemos si aún hay cupo" };
    }

    // Se cobra lo que falta, descontando lo que ya enviaste por transferencia y está en revisión
    const enRevision = reserva.payments.filter((p) => p.status === "PENDING_VERIFICATION").reduce((s, p) => s + p.amount_cents, 0);
    const falta = reserva.total_cents - reserva.paid_cents - enRevision;
    if (falta <= 0) return { error: "No hay nada pendiente por cobrar con tarjeta" };

    const { data: fila, error } = await db.from("bookings").select("itbis_cents").eq("id", reserva.id).single();
    if (error || !fila) throw new Error(`No se pudo leer la reserva: ${error?.message ?? "sin datos"}`);

    const inicio = await startCardPayment({
      store: createSupabaseAzulStore(db),
      config: setup.config,
      siteUrl: setup.siteUrl,
      booking: { id: reserva.id, currency: reserva.currency, totalCents: reserva.total_cents, itbisCents: Number(fila.itbis_cents) },
      amountCents: falta,
      orderNumber: randomBytes(8).toString("hex").slice(0, 15), // 15 caracteres: por debajo de cualquier límite razonable de Azul
    });
    return inicio.ok ? { form: inicio.form } : { error: inicio.error };
  } catch (error) {
    logError("online.card_start_failed", error);
    return { error: "No se pudo iniciar el pago con tarjeta. Inténtalo de nuevo o escríbenos por WhatsApp" };
  }
}
