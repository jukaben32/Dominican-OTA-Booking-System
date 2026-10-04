// Aplica un pago a un plan en "cascada": el dinero va primero a la cuota más antigua.
// Es una función PURA: no modifica lo que recibe, devuelve copias nuevas.
// La base de datos se encarga de guardarlo todo dentro de una sola transacción.

import { diffDays, type IsoDate } from "./dates";
import type { Cents } from "./money";

export type InstallmentStatus = "PENDING" | "PAID" | "PARTIAL" | "OVERDUE" | "WAIVED";
export type PlanStatus = "ACTIVE" | "COMPLETED" | "OVERDUE";
export type BookingPaymentStatus = "PENDING_PAYMENT" | "PARTIALLY_PAID" | "PAID";

export interface PlanInstallment {
  sequence: number;
  amountCents: Cents;
  paidCents: Cents;
  dueDate: IsoDate;
  status: InstallmentStatus;
}

export interface PaymentResult {
  installments: PlanInstallment[]; // mismo orden que el recibido
  planStatus: PlanStatus;
  appliedCents: Cents; // dinero que se asignó a cuotas
  unappliedCents: Cents; // sobrante si se pagó de más (hay que devolverlo o dejarlo a favor)
}

// Recalcula el estado de cada cuota según lo pagado y la fecha de hoy
export function refreshInstallments(
  installments: readonly PlanInstallment[],
  today: IsoDate,
): PlanInstallment[] {
  return installments.map((c) => {
    if (c.status === "WAIVED") return { ...c };
    if (c.paidCents >= c.amountCents) return { ...c, status: "PAID" };
    if (c.paidCents > 0) return { ...c, status: "PARTIAL" };
    return { ...c, status: diffDays(c.dueDate, today) > 0 ? "OVERDUE" : "PENDING" };
  });
}

// Estado general del plan
export function derivePlanStatus(
  installments: readonly PlanInstallment[],
  today: IsoDate,
): PlanStatus {
  const activas = installments.filter((c) => c.status !== "WAIVED");
  if (activas.every((c) => c.paidCents >= c.amountCents)) return "COMPLETED";
  const hayVencidaSinPagar = activas.some(
    (c) => c.paidCents < c.amountCents && diffDays(c.dueDate, today) > 0,
  );
  return hayVencidaSinPagar ? "OVERDUE" : "ACTIVE";
}

export function applyPayment(
  installments: readonly PlanInstallment[],
  amountCents: Cents,
  today: IsoDate,
): PaymentResult {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("El pago debe ser un número entero positivo de centavos");
  }

  const copia = installments.map((c) => ({ ...c }));

  // Orden de pago: la cuota que vence primero se paga primero
  const orden = copia
    .map((c, indice) => ({ c, indice }))
    .filter(({ c }) => c.status !== "WAIVED")
    .sort((a, b) => a.c.dueDate.localeCompare(b.c.dueDate) || a.c.sequence - b.c.sequence);

  let restante = amountCents;
  for (const { c } of orden) {
    if (restante === 0) break;
    const falta = c.amountCents - c.paidCents;
    if (falta <= 0) continue;
    const aplicado = Math.min(falta, restante);
    c.paidCents += aplicado;
    restante -= aplicado;
  }

  const actualizadas = refreshInstallments(copia, today);
  return {
    installments: actualizadas,
    planStatus: derivePlanStatus(actualizadas, today),
    appliedCents: amountCents - restante,
    unappliedCents: restante,
  };
}

// Estado de cobro de la reserva. OJO: PAID no emite el boleto; un agente lo emite después.
export function deriveBookingStatus(
  paidCents: Cents,
  totalCents: Cents,
): BookingPaymentStatus {
  if (paidCents <= 0) return "PENDING_PAYMENT";
  if (paidCents >= totalCents) return "PAID";
  return "PARTIALLY_PAID";
}
