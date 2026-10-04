// Resumen de ventas para el administrador. Función pura (sin base de datos): se prueba con filas de ejemplo.
// Reglas: los montos de cada moneda se resumen POR SEPARADO (nunca se suman dólares con pesos), y las reservas
// canceladas, vencidas o reembolsadas no cuentan como venta.

import { todayInSantoDomingo } from "../dates";
import type { Cents, Currency } from "../money";

export type BookingSource = "AGENT" | "ONLINE";

export interface SalesRow {
  created_at: string;
  status: string;
  currency: Currency;
  source: BookingSource;
  total_cents: Cents;
  paid_cents: Cents;
  service_fee_cents: Cents; // cargo de la agencia (antes del ITBIS)
}

export interface Bucket {
  count: number;
  totalCents: Cents;
  paidCents: Cents;
  feeCents: Cents;
}

export interface CurrencySummary extends Bucket {
  currency: Currency;
  pendingCents: Cents; // lo que falta cobrar de las reservas activas
  realizedFeeCents: Cents; // cargo de reservas ya pagadas al 100 %
  lostCount: number; // canceladas, vencidas o reembolsadas
  byMonth: ({ month: string } & Bucket)[]; // más reciente primero
  bySource: Record<BookingSource, Bucket>;
}

const LOST = new Set(["CANCELLED", "EXPIRED", "REFUNDED"]);
const FULLY_PAID = new Set(["PAID", "TICKETED"]);

const vacio = (): Bucket => ({ count: 0, totalCents: 0, paidCents: 0, feeCents: 0 });

function sumar(b: Bucket, r: SalesRow): void {
  b.count += 1;
  b.totalCents += r.total_cents;
  b.paidCents += r.paid_cents;
  b.feeCents += r.service_fee_cents;
}

export function summarizeSales(rows: readonly SalesRow[]): CurrencySummary[] {
  const porMoneda = new Map<Currency, { resumen: CurrencySummary; meses: Map<string, Bucket> }>();

  for (const r of rows) {
    let entrada = porMoneda.get(r.currency);
    if (!entrada) {
      entrada = {
        resumen: { currency: r.currency, ...vacio(), pendingCents: 0, realizedFeeCents: 0, lostCount: 0, byMonth: [], bySource: { AGENT: vacio(), ONLINE: vacio() } },
        meses: new Map(),
      };
      porMoneda.set(r.currency, entrada);
    }
    const { resumen, meses } = entrada;

    if (LOST.has(r.status)) {
      resumen.lostCount += 1;
      continue;
    }
    sumar(resumen, r);
    sumar(resumen.bySource[r.source], r);
    resumen.pendingCents += Math.max(0, r.total_cents - r.paid_cents);
    if (FULLY_PAID.has(r.status)) resumen.realizedFeeCents += r.service_fee_cents;

    const mes = todayInSantoDomingo(new Date(r.created_at)).slice(0, 7); // "2026-10"
    const bucket = meses.get(mes) ?? vacio();
    sumar(bucket, r);
    meses.set(mes, bucket);
  }

  return [...porMoneda.values()]
    .map(({ resumen, meses }) => ({
      ...resumen,
      byMonth: [...meses.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([month, b]) => ({ month, ...b })),
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}
