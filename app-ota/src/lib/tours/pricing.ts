// Economía de un paquete turístico.
//
// Un tour se vende a un precio TODO INCLUIDO por persona. Para registrarlo en una reserva hay que repartir
// ese precio en las tres partes que exige el sistema (y la DGII):
//   costo del proveedor + cargo de la agencia (tu ganancia) + ITBIS 18 % SOLO sobre tu cargo.
// ⚠️ Cómo se gravan los paquetes turísticos lo define el contador (ver plan, sección 3).

import { percentOf, type Cents } from "../money";
import { ITBIS_PERCENT } from "../pricing";

export interface PackageSplit {
  supplierCostCents: Cents;
  serviceFeeCents: Cents;
  itbisCents: Cents;
  negativeMargin: boolean; // el costo estimado supera el precio: la salida pierde dinero
}

// Reparte "totalCents" dado el costo estimado. Garantiza SIEMPRE:
//   costo + cargo + ITBIS = total   y   ITBIS = 18 % del cargo (redondeado igual que la base de datos).
// Los centavos de redondeo los absorbe el costo del proveedor.
export function splitPackagePrice(totalCents: Cents, estimatedCostCents: Cents): PackageSplit {
  if (!Number.isInteger(totalCents) || totalCents <= 0) throw new Error("El total debe ser un entero positivo de centavos");
  if (!Number.isInteger(estimatedCostCents) || estimatedCostCents < 0) {
    throw new Error("El costo estimado debe ser un entero de centavos mayor o igual a cero");
  }

  if (estimatedCostCents >= totalCents) {
    return {
      supplierCostCents: totalCents,
      serviceFeeCents: 0,
      itbisCents: 0,
      negativeMargin: estimatedCostCents > totalCents,
    };
  }

  const margen = totalCents - estimatedCostCents;
  // margen = cargo + ITBIS = cargo * 1.18  ->  cargo = margen / 1.18
  const cargo = Math.floor((margen * 100) / (100 + ITBIS_PERCENT));
  const itbis = percentOf(cargo, ITBIS_PERCENT);
  return {
    supplierCostCents: totalCents - cargo - itbis,
    serviceFeeCents: cargo,
    itbisCents: itbis,
    negativeMargin: false,
  };
}

export interface CostItem {
  description: string;
  amountCents: Cents; // en la moneda del proveedor
  fxRateToBase: number; // cuánto vale 1 unidad de esa moneda en la moneda del tour (1 si es la misma)
  basis: "PER_PERSON" | "PER_GROUP";
}

// Costo total en la moneda del tour para "pax" pasajeros
export function costForPax(items: readonly CostItem[], pax: number): Cents {
  if (!Number.isInteger(pax) || pax < 0) throw new Error("Los pasajeros deben ser un entero mayor o igual a cero");
  let total = 0;
  for (const item of items) {
    if (!Number.isFinite(item.fxRateToBase) || item.fxRateToBase <= 0) {
      throw new Error(`La tasa de cambio de "${item.description}" debe ser mayor que cero`);
    }
    const convertido = Math.round(item.amountCents * item.fxRateToBase);
    total += item.basis === "PER_PERSON" ? convertido * pax : convertido;
  }
  return total;
}

// Costo estimado POR ASIENTO: los costos de grupo (guía, bus) se reparten entre los pasajeros de planificación
// (se usa el mínimo para que la salida se realice). Se redondea hacia arriba para no subestimar el costo.
// Así una reserva de 2 personas no carga con todo el costo del grupo.
export function costPerPax(items: readonly CostItem[], planningPax: number): Cents {
  if (!Number.isInteger(planningPax) || planningPax < 1) {
    throw new Error("Los pasajeros de planificación deben ser un entero de 1 en adelante");
  }
  return Math.ceil(costForPax(items, planningPax) / planningPax);
}

export interface DepartureEconomicsInput {
  items: readonly CostItem[];
  pricePerPersonCents: Cents;
  pax: number;
  capacity?: number; // para calcular el punto de equilibrio
}

export interface DepartureEconomics {
  revenueCents: Cents;
  costCents: Cents;
  serviceFeeCents: Cents; // la ganancia de la agencia (antes de impuestos sobre la renta)
  itbisCents: Cents;
  profitPerPaxCents: Cents;
  negativeMargin: boolean;
  breakEvenPax: number | null; // mínimo de pasajeros con ganancia positiva (null si ni con cupo lleno)
}

export function departureEconomics(input: DepartureEconomicsInput): DepartureEconomics {
  const { items, pricePerPersonCents, pax, capacity } = input;
  if (!Number.isInteger(pricePerPersonCents) || pricePerPersonCents <= 0) {
    throw new Error("El precio por persona debe ser un entero positivo de centavos");
  }

  const evaluar = (n: number) => {
    const revenue = pricePerPersonCents * n;
    const cost = costForPax(items, n);
    return { revenue, cost, split: revenue > 0 ? splitPackagePrice(revenue, cost) : null };
  };

  const actual = evaluar(pax);
  const split = actual.split ?? { serviceFeeCents: 0, itbisCents: 0, negativeMargin: false };

  let breakEvenPax: number | null = null;
  for (let n = 1; n <= (capacity ?? pax); n++) {
    const e = evaluar(n);
    if (e.split && e.split.serviceFeeCents > 0) {
      breakEvenPax = n;
      break;
    }
  }

  return {
    revenueCents: actual.revenue,
    costCents: actual.cost,
    serviceFeeCents: split.serviceFeeCents,
    itbisCents: split.itbisCents,
    profitPerPaxCents: pax > 0 ? Math.floor(split.serviceFeeCents / pax) : 0,
    negativeMargin: split.negativeMargin,
    breakEvenPax,
  };
}
