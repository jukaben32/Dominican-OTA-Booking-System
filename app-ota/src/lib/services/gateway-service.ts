// Procesa los avisos de la pasarela de pago (Azul/CardNET).
//
// ⚠️ Este es el CONTRATO INTERNO de la Fase 1: la pasarela real (Azul usa su "Payment Page"
// con un hash de autenticación, no un webhook con este formato) se conecta mediante un
// ADAPTADOR que convierte su respuesta a este evento y lo firma. Ese adaptador se escribe
// cuando existan las credenciales y la documentación reales del portal de Azul.

import { z } from "zod";
import type { IsoDate } from "../dates";
import { assessFraudRisk } from "../fraud";
import {
  PaymentError,
  recordGatewayPayment,
  type PaymentOutcome,
  type PaymentStore,
} from "./payment-service";

export const gatewayEventSchema = z.object({
  eventId: z.string().min(1).max(200),
  bookingCode: z.string().min(1).max(50),
  amountCents: z.number().int().positive(),
  currency: z.enum(["USD", "DOP"]),
  status: z.enum(["APPROVED", "DECLINED"]),
  gatewayReference: z.string().min(1).max(200),
  cardCountry: z.string().length(2).optional(),
  cardHolderName: z.string().max(200).optional(),
});

export type GatewayEvent = z.infer<typeof gatewayEventSchema>;

export interface GatewayBooking {
  id: string;
  currency: "USD" | "DOP";
  status: string;
  totalCents: number;
  passengerNames: string[];
  departureDate: IsoDate | null;
}

export interface GatewayStore {
  findBookingByCode(code: string): Promise<GatewayBooking | null>;
  flagForReview(bookingId: string, reasons: string[]): Promise<void>;
  // Deja constancia en la auditoría (para conciliar a mano lo que no se pudo aplicar)
  logEvent(action: string, entityId: string, details: Record<string, unknown>): Promise<void>;
}

export type GatewayResult =
  | { result: PaymentOutcome["outcome"]; outcome: PaymentOutcome }
  | { result: "DECLINED_LOGGED" }
  | {
      result:
        | "REJECTED_UNKNOWN_BOOKING"
        | "REJECTED_CURRENCY"
        | "REJECTED_BOOKING_CLOSED"
        | "REJECTED_PAYMENT";
    };

const CLOSED_STATUSES = new Set(["CANCELLED", "EXPIRED", "REFUNDED"]);

interface ProcessInput {
  pagosStore: PaymentStore;
  gatewayStore: GatewayStore;
  event: GatewayEvent;
  today: IsoDate;
}

export async function processGatewayEvent(input: ProcessInput): Promise<GatewayResult> {
  const { pagosStore, gatewayStore, event, today } = input;

  const reserva = await gatewayStore.findBookingByCode(event.bookingCode);
  if (!reserva) {
    await gatewayStore.logEvent("GATEWAY_EVENT_REJECTED", event.bookingCode, {
      reason: "UNKNOWN_BOOKING",
      eventId: event.eventId,
      amountCents: event.amountCents,
    });
    return { result: "REJECTED_UNKNOWN_BOOKING" };
  }

  if (event.status === "DECLINED") {
    await gatewayStore.logEvent("GATEWAY_PAYMENT_DECLINED", reserva.id, {
      eventId: event.eventId,
      gatewayReference: event.gatewayReference,
    });
    return { result: "DECLINED_LOGGED" };
  }

  // A partir de aquí el banco SÍ cobró: si no podemos aplicar el dinero, hay que devolverlo o conciliarlo
  if (reserva.currency !== event.currency) {
    await gatewayStore.logEvent("GATEWAY_EVENT_REJECTED", reserva.id, {
      reason: "CURRENCY_MISMATCH",
      eventId: event.eventId,
      amountCents: event.amountCents,
      paidIn: event.currency,
      bookingIn: reserva.currency,
    });
    return { result: "REJECTED_CURRENCY" };
  }

  if (CLOSED_STATUSES.has(reserva.status)) {
    await gatewayStore.logEvent("GATEWAY_EVENT_REJECTED", reserva.id, {
      reason: "BOOKING_CLOSED",
      status: reserva.status,
      eventId: event.eventId,
      amountCents: event.amountCents,
    });
    return { result: "REJECTED_BOOKING_CLOSED" };
  }

  let outcome: PaymentOutcome;
  try {
    outcome = await recordGatewayPayment(
      pagosStore,
      {
        bookingId: reserva.id,
        amountCents: event.amountCents,
        currency: event.currency,
        method: "CARD",
        idempotencyKey: `gateway:${event.eventId}`,
        gatewayReference: event.gatewayReference,
      },
      today,
    );
  } catch (error) {
    // Reglas de negocio de la base (plan en mora, montos que no cuadran...): el banco cobró pero no se
    // pudo aplicar. Dejamos constancia para conciliar a mano. Cualquier otro error se propaga (se reintenta).
    if (!(error instanceof PaymentError)) throw error;
    await gatewayStore.logEvent("GATEWAY_EVENT_REJECTED", reserva.id, {
      reason: "PAYMENT_NOT_APPLICABLE",
      message: error.message,
      eventId: event.eventId,
      amountCents: event.amountCents,
    });
    return { result: "REJECTED_PAYMENT" };
  }

  // Revisión de fraude: NO bloquea el pago, marca la reserva para que un agente la revise antes de emitir.
  // Se evalúa también en reintentos (ALREADY_APPLIED): si la marca falló la primera vez, no se pierde.
  if (event.cardHolderName && event.cardCountry && reserva.departureDate) {
    const riesgo = assessFraudRisk({
      today,
      departureDate: reserva.departureDate,
      cardHolderName: event.cardHolderName,
      passengerNames: reserva.passengerNames,
      cardCountry: event.cardCountry,
      // El umbral está en dólares: con pagos en pesos no se evalúa ese criterio
      amountCents: event.currency === "USD" ? event.amountCents : 0,
      // Intentos y antigüedad de cuenta aplican al checkout web (Fase 2)
      paymentAttempts: 1,
      accountAgeHours: Number.MAX_SAFE_INTEGER,
    });
    if (riesgo.requiresReview) await gatewayStore.flagForReview(reserva.id, riesgo.reasons);
  }

  return { result: outcome.outcome, outcome };
}
