// Servicio que registra y aplica pagos.
// Orquesta los pasos usando un "almacén" (PaymentStore) intercambiable:
//   - en producción es Supabase (supabase-payment-store.ts),
//   - en las pruebas es un almacén falso en memoria.
// Los CÁLCULOS están en payment-waterfall.ts (probado); la base de datos solo guarda.

import type { IsoDate } from "../dates";
import type { Cents, Currency } from "../money";
import {
  applyPayment,
  type BookingPaymentStatus,
  type PlanInstallment,
  type PlanStatus,
} from "../payment-waterfall";

export type PaymentMethod = "CARD" | "TRANSFER" | "CASH";
export type PaymentRecordStatus = "PENDING_VERIFICATION" | "APPROVED" | "REJECTED" | "REFUNDED";

export interface StoredPayment {
  id: string;
  bookingId: string;
  planId: string | null;
  amountCents: Cents;
  currency: Currency;
  status: PaymentRecordStatus;
}

export interface NewPayment {
  bookingId: string;
  planId: string | null;
  amountCents: Cents;
  currency: Currency;
  method: PaymentMethod;
  idempotencyKey: string;
  gatewayReference?: string;
  bankReference?: string;
  proofPath?: string; // ruta en Storage PRIVADO
  createdBy?: string; // quién lo registró (agente); null cuando viene de la pasarela
}

export interface LoadedPlan {
  planId: string;
  version: number;
  installments: PlanInstallment[];
}

// Lo que el servidor PROPONE. Los montos reales los recalcula la base de datos con la reserva bloqueada.
export interface ApplyArgs {
  paymentId: string;
  expectedVersion: number;
  installments: { sequence: number; paid_cents: number; status: string }[]; // vacío si no hay plan
  planStatus: PlanStatus;
  actorId: string | null;
}

// Lo que la base de datos REALMENTE aplicó
export interface ApplyResult {
  result: "APPLIED" | "ALREADY_APPLIED";
  appliedCents: Cents;
  unappliedCents: Cents; // sobrante (pagaron de más): la base deja una alerta en la auditoría
  bookingStatus: BookingPaymentStatus | null;
}

// El almacén lanza esto cuando el plan cambió mientras calculábamos (dos pagos simultáneos)
export class VersionConflictError extends Error {
  constructor() {
    super("VERSION_CONFLICT");
    this.name = "VersionConflictError";
  }
}

export class PaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentError";
  }
}

export interface PaymentStore {
  findPaymentByKey(idempotencyKey: string): Promise<StoredPayment | null>;
  getPayment(paymentId: string): Promise<StoredPayment | null>;
  // Debe tolerar la carrera de dos inserciones con la misma clave (devolviendo la existente)
  insertPayment(payment: NewPayment): Promise<StoredPayment>;
  findPlanIdForBooking(bookingId: string): Promise<string | null>;
  loadPlan(planId: string): Promise<LoadedPlan | null>;
  applyPayment(args: ApplyArgs): Promise<ApplyResult>;
}

export interface PaymentOutcome {
  outcome: "APPLIED" | "ALREADY_APPLIED";
  paymentId: string;
  appliedCents: Cents;
  unappliedCents: Cents;
  planStatus: PlanStatus | null;
  bookingStatus: BookingPaymentStatus | null;
}

const MAX_ATTEMPTS = 3;

type RegisterInput = Omit<NewPayment, "planId">;

// Paso 1: registra el pago (queda PENDING_VERIFICATION). Si la clave ya existe, no duplica.
export async function registerPayment(
  store: PaymentStore,
  input: RegisterInput,
): Promise<{ payment: StoredPayment; created: boolean }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new PaymentError("El monto del pago debe ser un entero positivo de centavos");
  }
  if (!input.idempotencyKey.trim()) {
    throw new PaymentError("Falta la clave de idempotencia del pago");
  }

  const existente = await store.findPaymentByKey(input.idempotencyKey);
  if (existente) {
    // La misma clave con otro monto, moneda o reserva NO es un reintento: es un error o un ataque
    const distinto =
      existente.bookingId !== input.bookingId ||
      existente.amountCents !== input.amountCents ||
      existente.currency !== input.currency;
    if (distinto) throw new PaymentError("La clave de idempotencia ya se usó con datos distintos");
    return { payment: existente, created: false };
  }

  const planId = await store.findPlanIdForBooking(input.bookingId);
  const payment = await store.insertPayment({ ...input, planId });
  return { payment, created: true };
}

// Paso 2: aplica el pago a las cuotas y a la reserva (con reintentos si hay conflicto)
export async function approvePayment(
  store: PaymentStore,
  paymentId: string,
  options: { actorId: string | null; today: IsoDate },
): Promise<PaymentOutcome> {
  for (let intento = 1; intento <= MAX_ATTEMPTS; intento++) {
    const pago = await store.getPayment(paymentId);
    if (!pago) throw new PaymentError("El pago no existe");
    if (pago.status === "APPROVED") return yaAplicado(paymentId);
    if (pago.status !== "PENDING_VERIFICATION") {
      throw new PaymentError(`No se puede aprobar un pago en estado ${pago.status}`);
    }

    const plan = pago.planId ? await store.loadPlan(pago.planId) : null;

    // Con plan, proponemos el nuevo estado de las cuotas (cálculo probado). Sin plan no hay nada que
    // proponer: la base de datos calcula cuánto falta por cobrar con la reserva bloqueada.
    let planStatus: PlanStatus | null = null;
    let installments: ApplyArgs["installments"] = [];
    if (plan) {
      const r = applyPayment(plan.installments, pago.amountCents, options.today);
      planStatus = r.planStatus;
      installments = r.installments.map((c) => ({
        sequence: c.sequence,
        paid_cents: c.paidCents,
        status: c.status,
      }));
    }

    try {
      const resultado = await store.applyPayment({
        paymentId,
        expectedVersion: plan?.version ?? 0,
        installments,
        planStatus: planStatus ?? "ACTIVE",
        actorId: options.actorId,
      });
      if (resultado.result === "ALREADY_APPLIED") return yaAplicado(paymentId);
      return {
        outcome: "APPLIED",
        paymentId,
        appliedCents: resultado.appliedCents,
        unappliedCents: resultado.unappliedCents,
        planStatus,
        bookingStatus: resultado.bookingStatus,
      };
    } catch (error) {
      // Solo reintentamos el conflicto de versión; cualquier otro error se propaga
      if (!(error instanceof VersionConflictError)) throw error;
    }
  }
  throw new PaymentError("No se pudo aplicar el pago por actividad simultánea. Inténtalo de nuevo");
}

function yaAplicado(paymentId: string): PaymentOutcome {
  return {
    outcome: "ALREADY_APPLIED",
    paymentId,
    appliedCents: 0,
    unappliedCents: 0,
    planStatus: null,
    bookingStatus: null,
  };
}

// Pago aprobado por la pasarela (tarjeta): registrar y aplicar de una vez, sin intervención humana
export function recordGatewayPayment(
  store: PaymentStore,
  input: RegisterInput,
  today: IsoDate,
): Promise<PaymentOutcome> {
  return registerPayment(store, input).then(({ payment }) =>
    approvePayment(store, payment.id, { actorId: null, today }),
  );
}
