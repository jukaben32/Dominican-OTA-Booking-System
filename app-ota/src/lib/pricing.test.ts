import { describe, expect, test } from "vitest";
import { buildQuote } from "./pricing";

describe("buildQuote", () => {
  test("boleto de US$ 450 con cargo de US$ 30 -> total US$ 485.40", () => {
    const q = buildQuote({
      supplierCostCents: 45000,
      serviceFeeCents: 3000,
      currency: "USD",
    });
    expect(q.itbisCents).toBe(540); // 18 % de 30.00
    expect(q.totalCents).toBe(48540);
  });

  test("el ITBIS solo se calcula sobre el cargo por servicio, no sobre el boleto", () => {
    const q = buildQuote({
      supplierCostCents: 1000000,
      serviceFeeCents: 0,
      currency: "USD",
    });
    expect(q.itbisCents).toBe(0);
    expect(q.totalCents).toBe(1000000);
  });

  test("calcula el margen real de la agencia (cargo menos nada de ITBIS)", () => {
    const q = buildQuote({
      supplierCostCents: 45000,
      serviceFeeCents: 3000,
      currency: "USD",
    });
    expect(q.marginCents).toBe(3000);
  });

  test("redondea el ITBIS al centavo más cercano", () => {
    const q = buildQuote({
      supplierCostCents: 10000,
      serviceFeeCents: 1234, // 18 % = 222.12 -> 222
      currency: "USD",
    });
    expect(q.itbisCents).toBe(222);
  });

  test("en DOP guarda la moneda y respeta el total", () => {
    const q = buildQuote({
      supplierCostCents: 2700000,
      serviceFeeCents: 180000,
      currency: "DOP",
    });
    expect(q.currency).toBe("DOP");
    expect(q.totalCents).toBe(2700000 + 180000 + 32400);
  });

  test("con tasa de cambio guarda el equivalente en DOP", () => {
    const q = buildQuote({
      supplierCostCents: 45000,
      serviceFeeCents: 3000,
      currency: "USD",
      fxRateToDop: 60,
    });
    expect(q.fxRate).toBe(60);
    expect(q.totalDopCents).toBe(2912400);
  });

  test("rechaza costos negativos o con decimales", () => {
    expect(() =>
      buildQuote({ supplierCostCents: -1, serviceFeeCents: 0, currency: "USD" }),
    ).toThrow();
    expect(() =>
      buildQuote({ supplierCostCents: 10.5, serviceFeeCents: 0, currency: "USD" }),
    ).toThrow();
  });
});
