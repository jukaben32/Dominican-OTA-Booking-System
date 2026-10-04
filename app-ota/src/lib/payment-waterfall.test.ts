import { describe, expect, test } from "vitest";
import {
  applyPayment,
  deriveBookingStatus,
  type PlanInstallment,
} from "./payment-waterfall";

// Plan de ejemplo: abono + 2 cuotas de US$ 250 (total US$ 750)
function planBase(): PlanInstallment[] {
  return [
    { sequence: 0, amountCents: 25000, paidCents: 0, dueDate: "2026-10-04", status: "PENDING" },
    { sequence: 1, amountCents: 25000, paidCents: 0, dueDate: "2026-10-18", status: "PENDING" },
    { sequence: 2, amountCents: 25000, paidCents: 0, dueDate: "2026-11-01", status: "PENDING" },
  ];
}

describe("applyPayment", () => {
  test("un pago exacto salda la primera cuota", () => {
    const r = applyPayment(planBase(), 25000, "2026-10-04");
    expect(r.installments[0].status).toBe("PAID");
    expect(r.installments[0].paidCents).toBe(25000);
    expect(r.installments[1].status).toBe("PENDING");
    expect(r.unappliedCents).toBe(0);
  });

  test("un pago parcial deja la cuota en PARTIAL", () => {
    const r = applyPayment(planBase(), 10000, "2026-10-04");
    expect(r.installments[0].status).toBe("PARTIAL");
    expect(r.installments[0].paidCents).toBe(10000);
  });

  test("un pago grande cae en cascada sobre las cuotas más viejas", () => {
    const r = applyPayment(planBase(), 40000, "2026-10-04");
    expect(r.installments[0].status).toBe("PAID");
    expect(r.installments[1].status).toBe("PARTIAL");
    expect(r.installments[1].paidCents).toBe(15000);
    expect(r.installments[2].paidCents).toBe(0);
  });

  test("paga primero las cuotas vencidas aunque estén desordenadas", () => {
    const desordenado = [...planBase()].reverse();
    const r = applyPayment(desordenado, 25000, "2026-10-04");
    const cuota0 = r.installments.find((i) => i.sequence === 0)!;
    expect(cuota0.status).toBe("PAID");
  });

  test("marca como OVERDUE las cuotas impagas con fecha vencida", () => {
    const r = applyPayment(planBase(), 25000, "2026-10-25");
    expect(r.installments[1].status).toBe("OVERDUE");
    expect(r.installments[2].status).toBe("PENDING");
  });

  test("el plan queda COMPLETED cuando todo está pagado", () => {
    const r = applyPayment(planBase(), 75000, "2026-10-04");
    expect(r.planStatus).toBe("COMPLETED");
    expect(r.unappliedCents).toBe(0);
  });

  test("devuelve el sobrante cuando se paga de más", () => {
    const r = applyPayment(planBase(), 80000, "2026-10-04");
    expect(r.planStatus).toBe("COMPLETED");
    expect(r.unappliedCents).toBe(5000);
    expect(r.appliedCents).toBe(75000);
  });

  test("el plan queda OVERDUE si hay una cuota vencida sin pagar", () => {
    const r = applyPayment(planBase(), 25000, "2026-10-25");
    expect(r.planStatus).toBe("OVERDUE");
  });

  test("el plan queda ACTIVE si va al día", () => {
    const r = applyPayment(planBase(), 25000, "2026-10-10");
    expect(r.planStatus).toBe("ACTIVE");
  });

  test("no modifica el arreglo original (inmutabilidad)", () => {
    const original = planBase();
    applyPayment(original, 25000, "2026-10-04");
    expect(original[0].paidCents).toBe(0);
    expect(original[0].status).toBe("PENDING");
  });

  test("ignora las cuotas perdonadas (WAIVED)", () => {
    const plan = planBase();
    plan[0] = { ...plan[0], status: "WAIVED" };
    const r = applyPayment(plan, 25000, "2026-10-04");
    expect(r.installments[0].status).toBe("WAIVED");
    expect(r.installments[1].status).toBe("PAID");
  });

  test("el plan con cuotas perdonadas y pagadas queda COMPLETED", () => {
    const plan = planBase();
    plan[0] = { ...plan[0], status: "WAIVED" };
    const r = applyPayment(plan, 50000, "2026-10-04");
    expect(r.planStatus).toBe("COMPLETED");
  });

  test("rechaza montos no positivos o con decimales", () => {
    expect(() => applyPayment(planBase(), 0, "2026-10-04")).toThrow();
    expect(() => applyPayment(planBase(), -100, "2026-10-04")).toThrow();
    expect(() => applyPayment(planBase(), 10.5, "2026-10-04")).toThrow();
  });
});

describe("deriveBookingStatus", () => {
  test("sin pagos -> PENDING_PAYMENT", () => {
    expect(deriveBookingStatus(0, 75000)).toBe("PENDING_PAYMENT");
  });

  test("pago parcial -> PARTIALLY_PAID", () => {
    expect(deriveBookingStatus(25000, 75000)).toBe("PARTIALLY_PAID");
  });

  test("pago completo -> PAID (no se emite solo: lo emite un agente)", () => {
    expect(deriveBookingStatus(75000, 75000)).toBe("PAID");
  });
});
