import { describe, expect, test } from "vitest";
import { summarizeSales, type SalesRow } from "./sales";

const fila = (extra: Partial<SalesRow> = {}): SalesRow => ({
  created_at: "2026-10-04T15:00:00Z", status: "PENDING_PAYMENT", currency: "USD", source: "AGENT",
  total_cents: 100000, paid_cents: 0, service_fee_cents: 20000, ...extra,
});

describe("summarizeSales", () => {
  test("sin reservas no devuelve nada", () => {
    expect(summarizeSales([])).toEqual([]);
  });

  test("suma ventas activas, lo cobrado, lo pendiente y el cargo de la agencia", () => {
    const [usd] = summarizeSales([
      fila({ status: "PAID", paid_cents: 100000 }),
      fila({ status: "PARTIALLY_PAID", paid_cents: 30000 }),
      fila({ status: "PENDING_PAYMENT" }),
    ]);
    expect(usd).toMatchObject({ count: 3, totalCents: 300000, paidCents: 130000, pendingCents: 170000, feeCents: 60000, realizedFeeCents: 20000 });
  });

  test("las canceladas, vencidas y reembolsadas no son venta: solo se cuentan aparte", () => {
    const [usd] = summarizeSales([fila(), fila({ status: "CANCELLED" }), fila({ status: "EXPIRED" }), fila({ status: "REFUNDED", paid_cents: 5000 })]);
    expect(usd.count).toBe(1);
    expect(usd.lostCount).toBe(3);
    expect(usd.totalCents).toBe(100000);
    expect(usd.paidCents).toBe(0);
  });

  test("nunca mezcla monedas: cada una tiene su propio resumen", () => {
    const res = summarizeSales([fila(), fila({ currency: "DOP", total_cents: 6000000, service_fee_cents: 1000000 })]);
    expect(res.map((r) => r.currency)).toEqual(["DOP", "USD"]);
    expect(res[0].totalCents).toBe(6000000);
    expect(res[1].totalCents).toBe(100000);
  });

  test("separa por origen (agente / en línea)", () => {
    const [usd] = summarizeSales([fila(), fila({ source: "ONLINE" }), fila({ source: "ONLINE" })]);
    expect(usd.bySource.AGENT.count).toBe(1);
    expect(usd.bySource.ONLINE.count).toBe(2);
    expect(usd.bySource.ONLINE.totalCents).toBe(200000);
  });

  test("agrupa por mes en hora de Santo Domingo, del más reciente al más antiguo", () => {
    const [usd] = summarizeSales([
      fila({ created_at: "2026-09-15T12:00:00Z" }),
      fila({ created_at: "2026-10-01T02:00:00Z" }), // 1 de octubre 02:00 UTC = 30 de septiembre 22:00 en Santo Domingo
      fila({ created_at: "2026-10-20T12:00:00Z" }),
    ]);
    expect(usd.byMonth.map((m) => [m.month, m.count])).toEqual([["2026-10", 1], ["2026-09", 2]]);
  });

  test("un pago de más no produce pendiente negativo", () => {
    const [usd] = summarizeSales([fila({ status: "PAID", paid_cents: 120000 })]);
    expect(usd.pendingCents).toBe(0);
  });
});
