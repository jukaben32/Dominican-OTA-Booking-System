import { describe, expect, test } from "vitest";
import { buildPaymentPlan, PaymentPlanError } from "./payment-plan";

// Datos base: grupo de diciembre, 4 cuotas quincenales, abono inicial de 25 %
const base = {
  totalCents: 100000, // US$ 1,000.00
  downPaymentPercent: 25,
  installmentCount: 4,
  frequency: "BIWEEKLY" as const,
  startDate: "2026-10-04",
  supplierDeadline: "2026-12-10",
};

describe("buildPaymentPlan", () => {
  test("el abono inicial es 25 % y vence el día de inicio (cuota 0)", () => {
    const plan = buildPaymentPlan(base);
    expect(plan.downPaymentCents).toBe(25000);
    expect(plan.installments[0]).toEqual({
      sequence: 0,
      kind: "DOWN_PAYMENT",
      amountCents: 25000,
      dueDate: "2026-10-04",
    });
  });

  test("la suma de todas las cuotas es exactamente el total", () => {
    const plan = buildPaymentPlan(base);
    const suma = plan.installments.reduce((s, i) => s + i.amountCents, 0);
    expect(suma).toBe(100000);
  });

  test("la última cuota absorbe los centavos del redondeo", () => {
    // 75000 / 4 = 18750 exacto; probamos un total que no divide exacto
    const plan = buildPaymentPlan({ ...base, totalCents: 100001 });
    const suma = plan.installments.reduce((s, i) => s + i.amountCents, 0);
    expect(suma).toBe(100001);
    const cuotas = plan.installments.filter((i) => i.kind === "INSTALLMENT");
    const ultima = cuotas[cuotas.length - 1];
    expect(ultima.amountCents).toBeGreaterThanOrEqual(cuotas[0].amountCents);
  });

  test("las cuotas quincenales vencen cada 14 días", () => {
    const plan = buildPaymentPlan(base);
    const fechas = plan.installments.map((i) => i.dueDate);
    expect(fechas).toEqual([
      "2026-10-04",
      "2026-10-18",
      "2026-11-01",
      "2026-11-15",
      "2026-11-29",
    ]);
  });

  test("las cuotas mensuales usan meses calendario", () => {
    const plan = buildPaymentPlan({
      ...base,
      frequency: "MONTHLY",
      installmentCount: 2,
      supplierDeadline: "2026-12-15",
    });
    expect(plan.installments.map((i) => i.dueDate)).toEqual([
      "2026-10-04",
      "2026-11-04",
      "2026-12-04",
    ]);
  });

  test("las cuotas semanales vencen cada 7 días", () => {
    const plan = buildPaymentPlan({
      ...base,
      frequency: "WEEKLY",
      installmentCount: 3,
    });
    expect(plan.installments.map((i) => i.dueDate)).toEqual([
      "2026-10-04",
      "2026-10-11",
      "2026-10-18",
      "2026-10-25",
    ]);
  });

  test("la fecha límite final es 7 días antes del vencimiento del proveedor", () => {
    const plan = buildPaymentPlan(base);
    expect(plan.finalDueDate).toBe("2026-12-03");
  });

  test("rechaza el plan si la última cuota pasa de la fecha límite final", () => {
    // Con vencimiento del proveedor el 2026-11-10, la fecha límite es 2026-11-03,
    // pero la última cuota caería el 2026-11-29
    expect(() =>
      buildPaymentPlan({ ...base, supplierDeadline: "2026-11-10" }),
    ).toThrow(PaymentPlanError);
  });

  test("rechaza el plan si la fecha límite ya pasó", () => {
    expect(() =>
      buildPaymentPlan({ ...base, supplierDeadline: "2026-10-08" }),
    ).toThrow(PaymentPlanError);
  });

  test("rechaza totales no positivos o con decimales", () => {
    expect(() => buildPaymentPlan({ ...base, totalCents: 0 })).toThrow(
      PaymentPlanError,
    );
    expect(() => buildPaymentPlan({ ...base, totalCents: 100.5 })).toThrow(
      PaymentPlanError,
    );
  });

  test("rechaza un abono inicial fuera de 20 %–50 %", () => {
    expect(() =>
      buildPaymentPlan({ ...base, downPaymentPercent: 10 }),
    ).toThrow(PaymentPlanError);
    expect(() =>
      buildPaymentPlan({ ...base, downPaymentPercent: 60 }),
    ).toThrow(PaymentPlanError);
  });

  test("rechaza un abono inicial NaN o infinito", () => {
    for (const downPaymentPercent of [Number.NaN, Infinity]) {
      expect(() => buildPaymentPlan({ ...base, downPaymentPercent })).toThrow(PaymentPlanError);
    }
  });

  test("rechaza un total tan pequeño que alguna cuota quedaría en cero centavos", () => {
    expect(() => buildPaymentPlan({ ...base, totalCents: 10, installmentCount: 12 })).toThrow(PaymentPlanError);
  });

  test("rechaza un número de cuotas fuera de 1–12", () => {
    expect(() => buildPaymentPlan({ ...base, installmentCount: 0 })).toThrow(
      PaymentPlanError,
    );
    expect(() => buildPaymentPlan({ ...base, installmentCount: 13 })).toThrow(
      PaymentPlanError,
    );
  });

  test("el plan nunca incluye intereses (todas las cuotas suman el total)", () => {
    const plan = buildPaymentPlan({ ...base, installmentCount: 3 });
    expect(plan.installments.reduce((s, i) => s + i.amountCents, 0)).toBe(
      base.totalCents,
    );
  });
});
