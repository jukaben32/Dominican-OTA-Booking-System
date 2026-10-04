// Pasajeros de un tour y cómo se calcula su precio.
//
//   ADULTO  paga el precio base (habitación doble). Si va en habitación INDIVIDUAL paga además el suplemento.
//   NIÑO    paga el precio de niño (si la salida no lo define, paga como adulto). Comparte la habitación de un adulto.
//   INFANTE paga un precio simbólico (puede ser 0), NO ocupa asiento y necesita un adulto responsable por cada uno.
//
// La edad se mide el ÚLTIMO DÍA del viaje (así lo hacen las aerolíneas): un niño que cumple 12 años durante el
// viaje ya se cobra como adulto. La base de datos vuelve a exigir estas reglas (migración 0009).

import { isIsoDate, type IsoDate } from "../dates";
import type { Cents } from "../money";

export type PassengerType = "ADULT" | "CHILD" | "INFANT";
export type RoomType = "DOUBLE" | "SINGLE";

export interface PassengerInput {
  name: string;
  type: PassengerType;
  birthDate: IsoDate | null;
  room: RoomType;
}

export interface DeparturePrices {
  adultCents: Cents; // adulto en habitación doble
  singleSupplementCents: Cents | null; // null = no se ofrece habitación individual
  childCents: Cents | null; // null = los niños pagan como adultos
  infantCents: Cents; // 0 = gratis
  childMaxAge: number; // edad máxima de niño, inclusive (ej. 11)
  infantMaxAge: number; // edad máxima de infante, inclusive (ej. 1)
}

export type PassengerValidation = { ok: true; value: PassengerInput[] } | { ok: false; error: string };

const MIN_PASSENGERS = 1;
const MAX_PASSENGERS = 9;

// Años cumplidos de "birthDate" en el día "onDate"
export function ageOn(birthDate: IsoDate, onDate: IsoDate): number {
  if (!isIsoDate(birthDate) || !isIsoDate(onDate)) throw new Error("Fecha inválida (se espera AAAA-MM-DD)");
  if (birthDate > onDate) throw new Error("La fecha de nacimiento es posterior a la fecha de referencia (está en el futuro)");
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [oy, om, od] = onDate.split("-").map(Number);
  const cumplioEsteAno = om > bm || (om === bm && od >= bd);
  return oy - by - (cumplioEsteAno ? 0 : 1);
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export function validatePassengers(
  pasajeros: readonly PassengerInput[],
  precios: DeparturePrices,
  tripEnd: IsoDate,
): PassengerValidation {
  if (pasajeros.length < MIN_PASSENGERS || pasajeros.length > MAX_PASSENGERS) {
    return fail(`Debe haber de ${MIN_PASSENGERS} a ${MAX_PASSENGERS} pasajeros por reserva`);
  }

  const normalizados: PassengerInput[] = [];
  for (const [i, p] of pasajeros.entries()) {
    const n = i + 1;
    const name = p.name.trim();
    if (name.length < 2 || name.length > 100) return fail(`El pasajero ${n} necesita un nombre completo (de 2 a 100 letras)`);
    if (p.type !== "ADULT" && p.type !== "CHILD" && p.type !== "INFANT") return fail(`El tipo del pasajero ${n} no es válido`);
    if (p.room !== "DOUBLE" && p.room !== "SINGLE") return fail(`La habitación del pasajero ${n} no es válida`);

    if (p.birthDate !== null && !isIsoDate(p.birthDate)) return fail(`La fecha de nacimiento del pasajero ${n} no es válida`);
    if (p.type !== "ADULT" && p.birthDate === null) {
      return fail(`Escribe la fecha de nacimiento del ${p.type === "CHILD" ? "niño" : "infante"} (pasajero ${n})`);
    }

    if (p.birthDate !== null) {
      if (p.birthDate > tripEnd) return fail(`La fecha de nacimiento del pasajero ${n} no es válida (está en el futuro)`);
      const edad = ageOn(p.birthDate, tripEnd);
      if (p.type === "INFANT" && edad > precios.infantMaxAge) {
        return fail(`El pasajero ${n} tendrá ${edad} años al terminar el viaje: ya no puede viajar como infante`);
      }
      if (p.type === "CHILD" && (edad <= precios.infantMaxAge || edad > precios.childMaxAge)) {
        return fail(
          edad <= precios.infantMaxAge
            ? `El pasajero ${n} tendrá ${edad} años al terminar el viaje: debe registrarse como infante`
            : `El pasajero ${n} tendrá ${edad} años al terminar el viaje: ya no puede viajar como niño, se cobra como adulto`,
        );
      }
      if (p.type === "ADULT" && edad <= precios.childMaxAge) {
        return fail(`El pasajero ${n} tendrá ${edad} años al terminar el viaje: debe registrarse como niño o infante`);
      }
    }

    if (p.room === "SINGLE") {
      if (p.type !== "ADULT") return fail(`La habitación individual solo aplica a adultos (pasajero ${n})`);
      if (precios.singleSupplementCents === null) return fail("Esta salida no ofrece habitación individual");
    }

    normalizados.push({ name, type: p.type, birthDate: p.birthDate, room: p.room });
  }

  const adultos = normalizados.filter((p) => p.type === "ADULT").length;
  const infantes = normalizados.filter((p) => p.type === "INFANT").length;
  if (adultos < 1) return fail("Debe viajar al menos un adulto");
  if (infantes > adultos) return fail(`Cada infante necesita un adulto: hay ${infantes} infantes y ${adultos} adultos`);

  return { ok: true, value: normalizados };
}

export type PriceLineCode = "ADULT_DOUBLE" | "ADULT_SINGLE" | "CHILD" | "INFANT";

export interface PriceLine {
  code: PriceLineCode;
  count: number;
  unitCents: Cents;
}

export interface BookingPrice {
  lines: PriceLine[];
  totalCents: Cents;
  seats: number; // asientos que ocupa (adultos + niños; los infantes no)
}

export const PRICE_LINE_LABEL: Record<PriceLineCode, string> = {
  ADULT_DOUBLE: "Adulto (habitación doble)",
  ADULT_SINGLE: "Adulto (habitación individual)",
  CHILD: "Niño",
  INFANT: "Infante",
};

// Precio de la reserva. Asume pasajeros ya validados con validatePassengers.
export function priceBooking(pasajeros: readonly PassengerInput[], precios: DeparturePrices): BookingPrice {
  const cuenta = { ADULT_DOUBLE: 0, ADULT_SINGLE: 0, CHILD: 0, INFANT: 0 };
  for (const p of pasajeros) {
    if (p.type === "ADULT") cuenta[p.room === "SINGLE" ? "ADULT_SINGLE" : "ADULT_DOUBLE"]++;
    else cuenta[p.type]++;
  }

  const unidad: Record<PriceLineCode, Cents> = {
    ADULT_DOUBLE: precios.adultCents,
    ADULT_SINGLE: precios.adultCents + (precios.singleSupplementCents ?? 0),
    CHILD: precios.childCents ?? precios.adultCents,
    INFANT: precios.infantCents,
  };

  const lines = (Object.keys(cuenta) as PriceLineCode[])
    .filter((code) => cuenta[code] > 0 && !(code === "INFANT" && unidad.INFANT === 0))
    .map((code) => ({ code, count: cuenta[code], unitCents: unidad[code] }));

  return {
    lines,
    totalCents: lines.reduce((suma, l) => suma + l.count * l.unitCents, 0),
    seats: cuenta.ADULT_DOUBLE + cuenta.ADULT_SINGLE + cuenta.CHILD,
  };
}

// Fila de una salida (como viene de la base de datos) -> precios que usa el cálculo
export interface DeparturePriceRow {
  price_per_person_cents: number;
  single_supplement_cents: number | null;
  child_price_cents: number | null;
  infant_price_cents: number;
  child_max_age: number;
  infant_max_age: number;
}

export function departurePricesFromRow(fila: DeparturePriceRow): DeparturePrices {
  return {
    adultCents: fila.price_per_person_cents,
    singleSupplementCents: fila.single_supplement_cents,
    childCents: fila.child_price_cents,
    infantCents: fila.infant_price_cents,
    childMaxAge: fila.child_max_age,
    infantMaxAge: fila.infant_max_age,
  };
}

// Texto corto para mostrar a un pasajero: "Ana Pérez (niño)"
export function passengerLabel(nombre: string, tipo: PassengerType, habitacion: RoomType): string {
  if (tipo === "CHILD") return `${nombre} (niño)`;
  if (tipo === "INFANT") return `${nombre} (infante)`;
  return habitacion === "SINGLE" ? `${nombre} (habitación individual)` : nombre;
}
