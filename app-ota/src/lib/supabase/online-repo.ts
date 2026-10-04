import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { hashAccessToken, isValidTokenFormat } from "../online/access-token";
import { zeroOrMany } from "./relations";

// Cuenta un intento para la clave dada. false = ya se alcanzó el máximo en la ventana de tiempo.
// Si la base falla, se rechaza el intento (mejor negar que dejar pasar sin límite).
export async function takeAttempt(db: SupabaseClient, keyHash: string, max: number, windowMinutes: number): Promise<boolean> {
  const { data, error } = await db.rpc("take_online_attempt", {
    p_key_hash: keyHash,
    p_max: max,
    p_window_minutes: windowMinutes,
  });
  if (error) throw new Error(`No se pudo registrar el intento: ${error.message}`);
  return data === true;
}

const SELECT = `id, code, status, currency, total_cents, paid_cents, hold_expires_at,
  customer:customers!inner(full_name),
  departure:tour_departures!inner(departs_on, returns_on, tour:tours!inner(title, slug, destination)),
  passengers(full_name, passenger_type, room_type),
  payments(id, amount_cents, method, status, created_at, rejection_reason)`;

const schema = z.object({
  id: z.string(),
  code: z.string(),
  status: z.string(),
  currency: z.enum(["USD", "DOP"]),
  total_cents: z.number(),
  paid_cents: z.number(),
  hold_expires_at: z.string().nullable(),
  customer: zeroOrMany(z.object({ full_name: z.string() })),
  departure: zeroOrMany(
    z.object({
      departs_on: z.string(),
      returns_on: z.string(),
      tour: zeroOrMany(z.object({ title: z.string(), slug: z.string(), destination: z.string() })),
    }),
  ),
  passengers: z.array(
    z.object({
      full_name: z.string(),
      passenger_type: z.enum(["ADULT", "CHILD", "INFANT"]),
      room_type: z.enum(["DOUBLE", "SINGLE"]),
    }),
  ),
  payments: z.array(
    z.object({
      id: z.string(),
      amount_cents: z.number(),
      method: z.string(),
      status: z.string(),
      created_at: z.string(),
      rejection_reason: z.string().nullable(),
    }),
  ),
});

export type OnlineBooking = Omit<z.infer<typeof schema>, "customer" | "departure"> & {
  customerName: string;
  departsOn: string;
  returnsOn: string;
  tourTitle: string;
  tourSlug: string;
  destination: string;
};

// Busca la reserva de un enlace secreto (de una compra en línea o de una reserva de agente a la que se le activó). null si el enlace no existe (o no tiene el formato correcto).
// Solo devuelve datos que el propio cliente ya conoce: nunca costos, ganancia ni notas internas.
export async function getOnlineBookingByToken(db: SupabaseClient, token: string): Promise<OnlineBooking | null> {
  if (!isValidTokenFormat(token)) return null;
  const { data, error } = await db
    .from("bookings")
    .select(SELECT)
    .eq("access_token_hash", hashAccessToken(token))
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la reserva: ${error.message}`);
  if (!data) return null;

  const fila = schema.parse(data);
  const salida = fila.departure[0];
  const tour = salida?.tour[0];
  const cliente = fila.customer[0];
  if (!salida || !tour || !cliente) return null;
  return {
    id: fila.id,
    code: fila.code,
    status: fila.status,
    currency: fila.currency,
    total_cents: fila.total_cents,
    paid_cents: fila.paid_cents,
    hold_expires_at: fila.hold_expires_at,
    passengers: fila.passengers,
    payments: fila.payments,
    customerName: cliente.full_name,
    departsOn: salida.departs_on,
    returnsOn: salida.returns_on,
    tourTitle: tour.title,
    tourSlug: tour.slug,
    destination: tour.destination,
  };
}
