// Crea el plan de apartado (Modelo B) de una reserva, con las reglas del negocio:
//   - solo con tarifa garantizada (cupo de grupo o precio garantizado por el proveedor),
//   - solo en reservas abiertas, sin pagos y sin plan,
//   - sin intereses: las cuotas suman exactamente el total,
//   - la última cuota vence 7 días antes del vencimiento del proveedor.
// Las reglas se revisan aquí para dar mensajes claros y TAMBIÉN las exige la función SQL
// create_payment_plan (nadie puede saltárselas llamando a la base directamente).

import { todayInSantoDomingo, type IsoDate } from "../dates";
import { buildPaymentPlan, PaymentPlanError, type Frequency } from "../payment-plan";

export interface PlanBookingInfo {
  id: string;
  currency: "USD" | "DOP";
  status: string;
  paidCents: number;
  totalCents: number;
  priceGuaranteed: boolean;
  hasGroupBlock: boolean;
  supplierDeadline: string | null; // fecha y hora (ISO) en que vence la tarifa del proveedor
  hasPlan: boolean;
}

export interface CreatePlanArgs {
  bookingId: string;
  frequency: Frequency;
  finalDueDate: IsoDate;
  installments: { sequence: number; kind: string; amount_cents: number; due_date: IsoDate }[];
  actorId: string;
}

export interface PlanStore {
  getBooking(bookingId: string): Promise<PlanBookingInfo | null>;
  createPlan(args: CreatePlanArgs): Promise<string>; // devuelve el id del plan
}

export interface CreatePlanInput {
  bookingId: string;
  downPaymentPercent: number;
  installmentCount: number;
  frequency: Frequency;
  today: IsoDate;
  actorId: string;
}

const OPEN_STATUSES = new Set(["QUOTED", "ON_HOLD", "PENDING_PAYMENT"]);

export async function createPlanForBooking(
  store: PlanStore,
  input: CreatePlanInput,
): Promise<{ planId: string }> {
  const reserva = await store.getBooking(input.bookingId);
  if (!reserva) throw new PaymentPlanError("La reserva no existe");
  if (!OPEN_STATUSES.has(reserva.status)) {
    throw new PaymentPlanError("Esta reserva ya no admite un plan de pago (está pagada, emitida, cancelada o vencida)");
  }
  if (reserva.paidCents > 0) throw new PaymentPlanError("La reserva ya tiene pagos: no se puede crear un plan");
  if (reserva.hasPlan) throw new PaymentPlanError("La reserva ya tiene un plan de pago");
  if (!reserva.priceGuaranteed && !reserva.hasGroupBlock) {
    throw new PaymentPlanError(
      "El apartado solo aplica con tarifa garantizada (cupo de grupo o precio garantizado por el proveedor). " +
        "Una tarifa individual puede subir mientras el cliente paga",
    );
  }
  if (!reserva.supplierDeadline) {
    throw new PaymentPlanError("Falta el vencimiento del proveedor: indícalo en la reserva");
  }

  const plan = buildPaymentPlan({
    totalCents: reserva.totalCents,
    downPaymentPercent: input.downPaymentPercent,
    installmentCount: input.installmentCount,
    frequency: input.frequency,
    startDate: input.today,
    // La base guarda fecha y hora en UTC; el plan trabaja con el día del calendario dominicano
    supplierDeadline: todayInSantoDomingo(new Date(reserva.supplierDeadline)),
  });

  const planId = await store.createPlan({
    bookingId: reserva.id,
    frequency: input.frequency,
    finalDueDate: plan.finalDueDate,
    installments: plan.installments.map((c) => ({
      sequence: c.sequence,
      kind: c.kind,
      amount_cents: c.amountCents,
      due_date: c.dueDate,
    })),
    actorId: input.actorId,
  });

  return { planId };
}
