import { describe, expect, test } from "vitest";
import { PaymentPlanError } from "../payment-plan";
import { createPlanForBooking, type PlanBookingInfo, type PlanStore } from "./plan-service";

const HOY = "2026-10-04";

function crearAlmacen(reserva: Partial<PlanBookingInfo> | null = {}) {
  const creados: Parameters<PlanStore["createPlan"]>[0][] = [];
  const base: PlanBookingInfo = {
    id: "reserva-1",
    currency: "USD",
    status: "QUOTED",
    paidCents: 0,
    totalCents: 100000,
    priceGuaranteed: true,
    hasGroupBlock: false,
    supplierDeadline: "2026-12-20T16:00:00Z", // 12:00 del 20 de diciembre en República Dominicana
    hasPlan: false,
    ...reserva,
  };
  const almacen: PlanStore = {
    async getBooking() {
      return reserva === null ? null : base;
    },
    async createPlan(args) {
      creados.push(args);
      return "plan-nuevo";
    },
  };
  return { almacen, creados };
}

const entrada = {
  bookingId: "reserva-1",
  downPaymentPercent: 25,
  installmentCount: 4,
  frequency: "BIWEEKLY" as const,
  today: HOY,
  actorId: "agente-1",
};

describe("createPlanForBooking", () => {
  test("crea el plan con el abono y las cuotas calculadas", async () => {
    const { almacen, creados } = crearAlmacen();
    const r = await createPlanForBooking(almacen, entrada);

    expect(r.planId).toBe("plan-nuevo");
    expect(creados).toHaveLength(1);
    expect(creados[0].installments.map((c) => c.amount_cents)).toEqual([25000, 18750, 18750, 18750, 18750]);
    expect(creados[0].installments[0]).toEqual({ sequence: 0, kind: "DOWN_PAYMENT", amount_cents: 25000, due_date: HOY });
    expect(creados[0].actorId).toBe("agente-1");
  });

  test("las cuotas suman exactamente el total (sin recargos)", async () => {
    const { almacen, creados } = crearAlmacen({ totalCents: 100001 });
    await createPlanForBooking(almacen, entrada);
    expect(creados[0].installments.reduce((s, c) => s + c.amount_cents, 0)).toBe(100001);
  });

  test("la fecha límite deja 7 días antes del vencimiento del proveedor (día dominicano)", async () => {
    const { almacen, creados } = crearAlmacen();
    await createPlanForBooking(almacen, entrada);
    expect(creados[0].finalDueDate).toBe("2026-12-13");
  });

  test("usa el día DOMINICANO del vencimiento (01:00 UTC del 21 es todavía el 20 en Santo Domingo)", async () => {
    const { almacen, creados } = crearAlmacen({ supplierDeadline: "2026-12-21T01:00:00Z" });
    await createPlanForBooking(almacen, entrada);
    expect(creados[0].finalDueDate).toBe("2026-12-13");
  });

  test("acepta un cupo de grupo aunque el precio no esté marcado como garantizado", async () => {
    const { almacen } = crearAlmacen({ priceGuaranteed: false, hasGroupBlock: true });
    await expect(createPlanForBooking(almacen, entrada)).resolves.toBeDefined();
  });

  test("RECHAZA si la tarifa no está garantizada y explica por qué", async () => {
    const { almacen, creados } = crearAlmacen({ priceGuaranteed: false });
    await expect(createPlanForBooking(almacen, entrada)).rejects.toThrow(/garantiz/i);
    expect(creados).toEqual([]);
  });

  test("rechaza si la reserva no existe, ya tiene pagos, ya tiene plan o está cerrada", async () => {
    for (const reserva of [null, { paidCents: 5000 }, { hasPlan: true }, { status: "CANCELLED" }, { status: "TICKETED" }]) {
      const { almacen } = crearAlmacen(reserva);
      await expect(createPlanForBooking(almacen, entrada)).rejects.toThrow(PaymentPlanError);
    }
  });

  test("rechaza si falta el vencimiento del proveedor", async () => {
    const { almacen } = crearAlmacen({ supplierDeadline: null });
    await expect(createPlanForBooking(almacen, entrada)).rejects.toThrow(/vencimiento/i);
  });

  test("rechaza si las cuotas no caben antes de la fecha límite", async () => {
    const { almacen } = crearAlmacen({ supplierDeadline: "2026-11-10T16:00:00Z" });
    await expect(createPlanForBooking(almacen, entrada)).rejects.toThrow(PaymentPlanError);
  });

  test("un monto con la misma moneda DOP también funciona", async () => {
    const { almacen, creados } = crearAlmacen({ currency: "DOP", totalCents: 6000000 });
    await createPlanForBooking(almacen, entrada);
    expect(creados[0].installments.reduce((s, c) => s + c.amount_cents, 0)).toBe(6000000);
  });
});
