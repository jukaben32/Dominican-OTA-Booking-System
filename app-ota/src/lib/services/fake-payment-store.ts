// Almacén FALSO en memoria para las pruebas. Imita las reglas de la función SQL apply_payment
// (que se prueba por separado en src/db/schema.test.ts con un Postgres real):
// recalcula lo aplicado con la reserva "bloqueada", exige misma moneda, reserva abierta y plan activo.

import type { Currency } from "../money";
import {
  PaymentError,
  VersionConflictError,
  type LoadedPlan,
  type NewPayment,
  type PaymentStore,
  type StoredPayment,
} from "./payment-service";

interface Opciones {
  total: number;
  conPlan?: boolean;
  conflictos?: number; // veces que falla con VERSION_CONFLICT antes de aceptar
  currency?: Currency; // moneda de la reserva
  status?: string; // estado inicial de la reserva
  planStatus?: string;
}

const CERRADAS = new Set(["CANCELLED", "EXPIRED", "REFUNDED"]);

export function crearAlmacenFalso(opciones: Opciones) {
  const pagos = new Map<string, StoredPayment>();
  const sobrantes = new Map<string, number>();
  const claves = new Map<string, string>();
  const auditoria: string[] = [];
  let siguiente = 1;
  let conflictosRestantes = opciones.conflictos ?? 0;
  let intentosDeAplicar = 0;

  const reserva = {
    totalCents: opciones.total,
    paidCents: 0,
    currency: opciones.currency ?? ("USD" as Currency),
    status: opciones.status ?? "PENDING_PAYMENT",
  };

  const plan: (LoadedPlan & { status: string }) | null = opciones.conPlan
    ? {
        planId: "plan-1",
        version: 0,
        status: opciones.planStatus ?? "ACTIVE",
        installments: [0, 1, 2, 3].map((i) => ({
          sequence: i,
          amountCents: opciones.total / 4,
          paidCents: 0,
          dueDate: ["2026-10-04", "2026-10-18", "2026-11-01", "2026-11-15"][i],
          status: "PENDING" as const,
        })),
      }
    : null;

  const almacen: PaymentStore = {
    async findPaymentByKey(clave) {
      const id = claves.get(clave);
      return id ? pagos.get(id)! : null;
    },
    async getPayment(id) {
      return pagos.get(id) ?? null;
    },
    async insertPayment(nuevo: NewPayment) {
      const id = `pago-${siguiente++}`;
      const pago: StoredPayment = {
        id,
        bookingId: nuevo.bookingId,
        planId: nuevo.planId,
        amountCents: nuevo.amountCents,
        currency: nuevo.currency,
        status: "PENDING_VERIFICATION",
      };
      pagos.set(id, pago);
      claves.set(nuevo.idempotencyKey, id);
      return pago;
    },
    async findPlanIdForBooking() {
      return plan && ["ACTIVE", "OVERDUE"].includes(plan.status) ? plan.planId : null;
    },
    async loadPlan() {
      return plan ? { planId: plan.planId, version: plan.version, installments: plan.installments.map((c) => ({ ...c })) } : null;
    },
    async applyPayment(args) {
      intentosDeAplicar++;
      if (conflictosRestantes > 0) {
        conflictosRestantes--;
        throw new VersionConflictError();
      }
      const pago = pagos.get(args.paymentId)!;
      if (pago.status === "APPROVED") {
        const sobrante = sobrantes.get(pago.id) ?? 0;
        return { result: "ALREADY_APPLIED", appliedCents: pago.amountCents - sobrante, unappliedCents: sobrante, bookingStatus: null };
      }
      if (pago.currency !== reserva.currency) throw new PaymentError("La moneda del pago no coincide con la de la reserva");
      if (CERRADAS.has(reserva.status)) throw new PaymentError("La reserva está cancelada, vencida o reembolsada");

      let aplicado: number;
      if (plan) {
        if (plan.version !== args.expectedVersion) throw new VersionConflictError();
        if (!["ACTIVE", "OVERDUE"].includes(plan.status)) throw new PaymentError("El plan de pago ya no está activo");
        const delta = args.installments.reduce((suma, nueva) => {
          const vieja = plan.installments.find((c) => c.sequence === nueva.sequence)!;
          return suma + (nueva.paid_cents - vieja.paidCents);
        }, 0);
        if (delta < 0 || delta > pago.amountCents) throw new PaymentError("Los montos del pago no cuadran con las cuotas");
        aplicado = delta;
        plan.version++;
        plan.status = args.planStatus;
        plan.installments = plan.installments.map((c) => {
          const nueva = args.installments.find((i) => i.sequence === c.sequence)!;
          return { ...c, paidCents: nueva.paid_cents, status: nueva.status as typeof c.status };
        });
      } else {
        aplicado = Math.min(pago.amountCents, Math.max(0, reserva.totalCents - reserva.paidCents));
      }

      const sobrante = pago.amountCents - aplicado;
      reserva.paidCents += aplicado;
      if (["QUOTED", "ON_HOLD", "PENDING_PAYMENT", "PARTIALLY_PAID"].includes(reserva.status)) {
        reserva.status = reserva.paidCents >= reserva.totalCents ? "PAID" : reserva.paidCents > 0 ? "PARTIALLY_PAID" : reserva.status;
      }
      pagos.set(pago.id, { ...pago, status: "APPROVED" });
      sobrantes.set(pago.id, sobrante);
      if (sobrante > 0) auditoria.push("PAYMENT_OVERPAID");

      return {
        result: "APPLIED",
        appliedCents: aplicado,
        unappliedCents: sobrante,
        bookingStatus: reserva.status as "PENDING_PAYMENT" | "PARTIALLY_PAID" | "PAID",
      };
    },
  };

  return { almacen, reserva, pagos, auditoria, getPlan: () => plan, intentos: () => intentosDeAplicar };
}
