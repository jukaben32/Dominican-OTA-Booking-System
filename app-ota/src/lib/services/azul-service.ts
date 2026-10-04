// Pago con tarjeta por la Página de Pago de Azul: inicio del cobro y procesamiento del regreso del cliente.
// La lógica usa "almacenes" intercambiables (en producción Supabase, en pruebas uno falso en memoria).
//
// Reglas de seguridad (no negociables):
//  - Nunca se cree lo que diga el navegador: la respuesta de Azul solo vale si su firma (AuthHash) es correcta.
//  - El MONTO que cuenta es el que guardamos al iniciar el cobro; si la respuesta firmada trae otro, se rechaza.
//  - Una entrada sin firma (cancelar) nunca cambia el estado de una transacción.
//  - El dinero se registra con el mismo camino que cualquier pasarela (idempotente por número de orden).

import type { IsoDate } from "../dates";
import type { Cents, Currency } from "../money";
import {
  buildAzulPaymentForm,
  isApproved,
  verifyAzulResponse,
  type AzulConfig,
  type AzulPaymentForm,
  type AzulResultParams,
} from "../payments/azul";
import { processGatewayEvent, type GatewayStore } from "./gateway-service";
import type { PaymentStore } from "./payment-service";

export type AzulTxnStatus = "pending" | "approved" | "declined" | "cancelled" | "error";

export interface AzulTransaction {
  id: string;
  orderNumber: string;
  bookingId: string;
  bookingCode: string;
  amountCents: Cents;
  currency: Currency;
  status: AzulTxnStatus;
}

export interface AzulStore {
  createTransaction(input: { bookingId: string; orderNumber: string; amountCents: Cents; currency: Currency }): Promise<void>;
  findByOrder(orderNumber: string): Promise<AzulTransaction | null>;
  setStatus(id: string, status: AzulTxnStatus, payload: Record<string, unknown>): Promise<void>;
}

export interface CardPaymentBooking {
  id: string;
  currency: Currency;
  totalCents: Cents;
  itbisCents: Cents;
}

export type StartCardPaymentResult = { ok: true; form: AzulPaymentForm } | { ok: false; error: string };

interface StartInput {
  store: AzulStore;
  config: AzulConfig;
  siteUrl: string;
  booking: CardPaymentBooking;
  amountCents: Cents; // lo que se cobrará ahora (hasta lo que falta por pagar)
  orderNumber: string; // aleatorio, lo genera quien llama
}

// ITBIS informativo del cobro: la parte proporcional del ITBIS de la reserva
export function proportionalItbis(booking: CardPaymentBooking, amountCents: Cents): Cents {
  return Math.round((booking.itbisCents * amountCents) / booking.totalCents);
}

// Registra el intento (queda "pending") y devuelve el formulario firmado que el NAVEGADOR enviará a Azul.
export async function startCardPayment(input: StartInput): Promise<StartCardPaymentResult> {
  const { store, config, siteUrl, booking, amountCents, orderNumber } = input;
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > booking.totalCents) {
    return { ok: false, error: "El monto a cobrar no es válido" };
  }
  const returnUrl = `${siteUrl}/api/pagos/azul/resultado`;
  const form = buildAzulPaymentForm({
    config,
    orderNumber,
    amountCents,
    itbisCents: proportionalItbis(booking, amountCents),
    currency: booking.currency,
    returnUrl,
    cancelUrl: `${returnUrl}?cancelado=1`,
  });
  if (!form) return { ok: false, error: "El pago con tarjeta no está disponible para esta moneda" };

  await store.createTransaction({ bookingId: booking.id, orderNumber, amountCents, currency: booking.currency });
  return { ok: true, form };
}

export type AzulReturnOutcome =
  | { outcome: "approved" | "declined" | "needs_review"; bookingId: string }
  | { outcome: "invalid"; reason: string };

interface ReturnInput {
  store: AzulStore;
  pagosStore: PaymentStore;
  gatewayStore: GatewayStore;
  config: AzulConfig;
  params: AzulResultParams;
  today: IsoDate;
}

// Procesa el regreso del cliente desde Azul. Se puede ejecutar varias veces con la misma respuesta (recargar la
// página, reintentos): el pago se registra una sola vez.
export async function handleAzulReturn(input: ReturnInput): Promise<AzulReturnOutcome> {
  const { store, pagosStore, gatewayStore, config, params, today } = input;

  const txn = await store.findByOrder(params.orderNumber);
  if (!txn) return { outcome: "invalid", reason: "Transacción desconocida" };

  // 1) La firma: sin ella no se cree nada ni se cambia ningún estado
  if (!verifyAzulResponse(params, config.authKey)) {
    await gatewayStore.logEvent("AZUL_BAD_SIGNATURE", txn.bookingId, { orderNumber: txn.orderNumber });
    return { outcome: "invalid", reason: "Firma de Azul no válida" };
  }
  // 2) El monto firmado debe ser el que iniciamos nosotros
  if (params.amount !== String(txn.amountCents)) {
    await gatewayStore.logEvent("AZUL_AMOUNT_MISMATCH", txn.bookingId, {
      orderNumber: txn.orderNumber,
      expected: txn.amountCents,
      received: params.amount,
    });
    // Con firma válida, Azul pudo haber cobrado: queda marcada para conciliar a mano (no se aplica dinero)
    await store.setStatus(txn.id, "error", { amountMismatch: true, expected: txn.amountCents, received: params.amount });
    return { outcome: "invalid", reason: "El monto de la respuesta no coincide" };
  }

  // "approved" y "error" son FINALES: repetir la respuesta no cambia nada ni vuelve a escribir en la auditoría
  if (txn.status === "approved") return { outcome: "approved", bookingId: txn.bookingId };
  if (txn.status === "error") return { outcome: "needs_review", bookingId: txn.bookingId };

  // Datos de la respuesta que se guardan para conciliar (nunca incluyen la firma ni datos de tarjeta)
  const registro = {
    authorizationCode: params.authorizationCode,
    dateTime: params.dateTime,
    responseCode: params.responseCode,
    isoCode: params.isoCode,
    responseMessage: params.responseMessage,
    errorDescription: params.errorDescription,
    rrn: params.rrn,
    azulOrderId: params.azulOrderId,
  };

  if (!isApproved(params)) {
    await store.setStatus(txn.id, "declined", registro);
    await gatewayStore.logEvent("GATEWAY_PAYMENT_DECLINED", txn.bookingId, { orderNumber: txn.orderNumber, isoCode: params.isoCode });
    return { outcome: "declined", bookingId: txn.bookingId };
  }

  // El banco SÍ cobró: se registra el dinero primero y se marca la transacción después (si algo se cae entre los
  // dos pasos, el reintento no duplica el pago porque la clave es el número de orden)
  const resultado = await processGatewayEvent({
    pagosStore,
    gatewayStore,
    today,
    event: {
      eventId: `azul:${txn.orderNumber}`,
      bookingCode: txn.bookingCode,
      amountCents: txn.amountCents,
      currency: txn.currency,
      status: "APPROVED",
      gatewayReference: params.azulOrderId || params.rrn || txn.orderNumber,
    },
  });

  if (resultado.result === "APPLIED" || resultado.result === "ALREADY_APPLIED") {
    await store.setStatus(txn.id, "approved", registro);
    return { outcome: "approved", bookingId: txn.bookingId };
  }
  // Cobrado pero no aplicable (reserva cerrada, plan en mora...): ya quedó en la auditoría para conciliar a mano
  await store.setStatus(txn.id, "error", { ...registro, applied: resultado.result });
  return { outcome: "needs_review", bookingId: txn.bookingId };
}
