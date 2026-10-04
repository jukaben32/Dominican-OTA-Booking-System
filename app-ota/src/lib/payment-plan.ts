// Construye un plan de apartado programado (Modelo B): SIN intereses, SIN recargos.
// Las cuotas siempre suman exactamente el total de la reserva.

import { addDays, addMonths, diffDays, type IsoDate } from "./dates";
import { percentOf, type Cents } from "./money";

export type Frequency = "WEEKLY" | "BIWEEKLY" | "MONTHLY";

export interface PlanItem {
  sequence: number; // 0 = abono inicial, 1..N = cuotas
  kind: "DOWN_PAYMENT" | "INSTALLMENT";
  amountCents: Cents;
  dueDate: IsoDate;
}

export interface PaymentPlanInput {
  totalCents: Cents;
  downPaymentPercent: number; // entre 20 y 50
  installmentCount: number; // entre 1 y 12 (sin contar el abono inicial)
  frequency: Frequency;
  startDate: IsoDate; // día del abono inicial
  supplierDeadline: IsoDate; // fecha límite del proveedor para emitir
  safetyDays?: number; // margen antes del vencimiento del proveedor (por defecto 7)
}

export interface PaymentPlanResult {
  downPaymentCents: Cents;
  remainingCents: Cents;
  finalDueDate: IsoDate; // última fecha en que puede vencer una cuota
  installments: PlanItem[];
}

export class PaymentPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentPlanError";
  }
}

const MIN_DOWN_PERCENT = 20;
const MAX_DOWN_PERCENT = 50;
const MAX_INSTALLMENTS = 12;
const DEFAULT_SAFETY_DAYS = 7;

// Calcula la fecha de la cuota número "k" (1, 2, 3...) según la frecuencia
function dueDateFor(start: IsoDate, frequency: Frequency, k: number): IsoDate {
  if (frequency === "WEEKLY") return addDays(start, 7 * k);
  if (frequency === "BIWEEKLY") return addDays(start, 14 * k);
  return addMonths(start, k);
}

function validate(input: PaymentPlanInput): void {
  if (!Number.isInteger(input.totalCents) || input.totalCents <= 0) {
    throw new PaymentPlanError("El total debe ser un número entero positivo de centavos");
  }
  if (
    !Number.isFinite(input.downPaymentPercent) ||
    input.downPaymentPercent < MIN_DOWN_PERCENT ||
    input.downPaymentPercent > MAX_DOWN_PERCENT
  ) {
    throw new PaymentPlanError(
      `El abono inicial debe estar entre ${MIN_DOWN_PERCENT} % y ${MAX_DOWN_PERCENT} %`,
    );
  }
  if (
    !Number.isInteger(input.installmentCount) ||
    input.installmentCount < 1 ||
    input.installmentCount > MAX_INSTALLMENTS
  ) {
    throw new PaymentPlanError(`Las cuotas deben ser entre 1 y ${MAX_INSTALLMENTS}`);
  }
}

export function buildPaymentPlan(input: PaymentPlanInput): PaymentPlanResult {
  validate(input);

  const safetyDays = input.safetyDays ?? DEFAULT_SAFETY_DAYS;
  // Nunca se puede cobrar una cuota después de esta fecha (hay que emitir antes)
  const finalDueDate = addDays(input.supplierDeadline, -safetyDays);

  if (diffDays(input.startDate, finalDueDate) <= 0) {
    throw new PaymentPlanError(
      "La fecha límite del proveedor es muy cercana: solo se acepta pago completo",
    );
  }

  const downPaymentCents = percentOf(input.totalCents, input.downPaymentPercent);
  const remainingCents = input.totalCents - downPaymentCents;

  // Cuotas iguales; el sobrante de centavos se suma a la última cuota
  const base = Math.floor(remainingCents / input.installmentCount);
  const resto = remainingCents - base * input.installmentCount;

  const items: PlanItem[] = [
    {
      sequence: 0,
      kind: "DOWN_PAYMENT",
      amountCents: downPaymentCents,
      dueDate: input.startDate,
    },
  ];

  for (let k = 1; k <= input.installmentCount; k++) {
    const esUltima = k === input.installmentCount;
    items.push({
      sequence: k,
      kind: "INSTALLMENT",
      amountCents: esUltima ? base + resto : base,
      dueDate: dueDateFor(input.startDate, input.frequency, k),
    });
  }

  // La base de datos exige que cada cuota sea mayor que cero
  if (items.some((i) => i.amountCents <= 0)) {
    throw new PaymentPlanError("El total es muy pequeño para ese número de cuotas");
  }

  const ultima = items[items.length - 1];
  if (diffDays(ultima.dueDate, finalDueDate) < 0) {
    throw new PaymentPlanError(
      `La última cuota (${ultima.dueDate}) pasa de la fecha límite (${finalDueDate}). ` +
        "Reduce las cuotas o usa una frecuencia más corta",
    );
  }

  return { downPaymentCents, remainingCents, finalDueDate, installments: items };
}
