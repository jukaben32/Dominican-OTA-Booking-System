import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "../logger";
import { departurePricesFromRow, priceBooking, validatePassengers, type PassengerInput } from "../tours/passengers";
import { parsePassengerRows } from "../tours/passenger-form";
import { costPerPax, splitPackagePrice, type CostItem } from "../tours/pricing";

type Reparto = ReturnType<typeof splitPackagePrice>;

// "usuario" = el mensaje se puede mostrar tal cual; "interno" = fallo nuestro (el mensaje es solo para el personal)
export type PreparedSale =
  | { ok: true; passengers: PassengerInput[]; split: Reparto }
  | { ok: false; error: string; kind: "usuario" | "interno" };

// Pasajeros del formulario -> validación + precio + reparto del precio (costo del proveedor / comisión / ITBIS).
// Lo usan la venta del agente y la compra en línea, para que el precio se calcule SIEMPRE igual.
// Debe recibir el cliente con llave de servicio: lee los costos, que ningún visitante ni agente puede ver.
export async function prepareTourSale(admin: SupabaseClient, departureId: string, formData: FormData): Promise<PreparedSale> {
  const { data: salida, error: errorSalida } = await admin
    .from("tour_departures")
    .select("price_per_person_cents, single_supplement_cents, child_price_cents, infant_price_cents, child_max_age, infant_max_age, min_passengers, returns_on")
    .eq("id", departureId)
    .maybeSingle();
  if (errorSalida || !salida) return { ok: false, error: "La salida no existe", kind: "usuario" };

  const { data: filas, error: errorCostos } = await admin
    .from("tour_cost_items")
    .select("description, amount_cents, fx_rate_to_base, basis")
    .eq("departure_id", departureId);
  if (errorCostos) {
    logError("sale.costs_failed", errorCostos, { departureId });
    return { ok: false, error: "No se pudo calcular el precio. Inténtalo de nuevo", kind: "interno" };
  }
  if (!filas || filas.length === 0) {
    return { ok: false, error: "Esta salida todavía no tiene costos cargados: avisa a un administrador", kind: "interno" };
  }

  const costos: CostItem[] = filas.map((f) => ({
    description: f.description as string,
    amountCents: Number(f.amount_cents),
    fxRateToBase: Number(f.fx_rate_to_base),
    basis: f.basis as CostItem["basis"],
  }));

  const precios = departurePricesFromRow({
    price_per_person_cents: Number(salida.price_per_person_cents),
    single_supplement_cents: salida.single_supplement_cents === null ? null : Number(salida.single_supplement_cents),
    child_price_cents: salida.child_price_cents === null ? null : Number(salida.child_price_cents),
    infant_price_cents: Number(salida.infant_price_cents),
    child_max_age: Number(salida.child_max_age),
    infant_max_age: Number(salida.infant_max_age),
  });
  const validacion = validatePassengers(parsePassengerRows(formData), precios, salida.returns_on as string);
  if (!validacion.ok) return { ok: false, error: validacion.error, kind: "usuario" };

  const precio = priceBooking(validacion.value, precios);
  // El costo estimado se calcula por ASIENTO (los infantes no ocupan asiento)
  const estimado = costPerPax(costos, Number(salida.min_passengers)) * precio.seats;
  return { ok: true, passengers: validacion.value, split: splitPackagePrice(precio.totalCents, estimado) };
}

// Pasajeros en el formato que espera la función SQL create_tour_booking
export function passengersForRpc(pasajeros: readonly PassengerInput[]) {
  return pasajeros.map((p) => ({ name: p.name, type: p.type, birth_date: p.birthDate, room: p.room }));
}
