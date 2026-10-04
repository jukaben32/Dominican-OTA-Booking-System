// Cotización: separa el costo del proveedor (dinero que se paga a la aerolínea/hotel)
// del cargo por servicio de la agencia. El ITBIS (18 %) se calcula SOLO sobre el cargo.
// ⚠️ El contador debe confirmar el tratamiento por tipo de producto (ver plan, sección 3).

import { convertCents, percentOf, type Cents, type Currency } from "./money";

export const ITBIS_PERCENT = 18;

export interface QuoteInput {
  supplierCostCents: Cents;
  serviceFeeCents: Cents; // lo que cobra la agencia (en paquetes incluye su margen)
  currency: Currency;
  fxRateToDop?: number; // tasa fijada al vender (si la moneda es USD)
}

export interface Quote {
  currency: Currency;
  supplierCostCents: Cents;
  serviceFeeCents: Cents;
  itbisCents: Cents;
  totalCents: Cents;
  marginCents: Cents; // ganancia bruta de la agencia (antes de comisión de pasarela)
  fxRate?: number;
  totalDopCents?: Cents;
}

function assertCents(valor: number, nombre: string): void {
  if (!Number.isInteger(valor) || valor < 0) {
    throw new Error(`${nombre} debe ser un entero de centavos mayor o igual a cero`);
  }
}

export function buildQuote(input: QuoteInput): Quote {
  assertCents(input.supplierCostCents, "El costo del proveedor");
  assertCents(input.serviceFeeCents, "El cargo por servicio");

  const itbisCents = percentOf(input.serviceFeeCents, ITBIS_PERCENT);
  const totalCents = input.supplierCostCents + input.serviceFeeCents + itbisCents;

  return {
    currency: input.currency,
    supplierCostCents: input.supplierCostCents,
    serviceFeeCents: input.serviceFeeCents,
    itbisCents,
    totalCents,
    marginCents: input.serviceFeeCents,
    ...(input.fxRateToDop !== undefined && {
      fxRate: input.fxRateToDop,
      totalDopCents: convertCents(totalCents, input.fxRateToDop),
    }),
  };
}
