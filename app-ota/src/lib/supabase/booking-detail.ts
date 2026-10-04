import { z } from "zod";
import { zeroOrMany } from "./relations";

// NO incluye supplier_cost_cents ni service_fee_cents: los agentes no tienen permiso de lectura sobre esas columnas
// (el costo y la ganancia los lee el servidor solo para el administrador). Consulta y esquema del detalle de una reserva. Se comparten entre la pantalla y las pruebas contra la base real.
export const BOOKING_DETAIL_SELECT = `id, code, status, product_type, currency, itbis_cents, total_cents,
       paid_cents, price_guaranteed, group_block_id, supplier_deadline, pnr, requires_review, review_reasons,
       departure_id, cancellation_snapshot, source, hold_expires_at,
       customer:customers!inner(full_name, phone_e164, whatsapp_opt_in_at),
       passengers(full_name, passenger_type, room_type),
       flight_segments(airline, origin_iata, dest_iata, departs_at),
       payment_plans(id, status, frequency, final_due_date,
         installments(sequence, kind, amount_cents, paid_cents, due_date, status)),
       payments(id, amount_cents, unapplied_cents, method, status, bank_reference, created_at)`;

export const bookingDetailSchema = z.object({
  id: z.string(),
  code: z.string(),
  status: z.string(),
  product_type: z.string(),
  currency: z.enum(["USD", "DOP"]),
  itbis_cents: z.number(),
  total_cents: z.number(),
  paid_cents: z.number(),
  price_guaranteed: z.boolean(),
  group_block_id: z.string().nullable(),
  departure_id: z.string().nullable(),
  source: z.enum(["AGENT", "ONLINE"]),
  hold_expires_at: z.string().nullable(),
  cancellation_snapshot: z.unknown().nullable(),
  supplier_deadline: z.string().nullable(),
  pnr: z.string().nullable(),
  requires_review: z.boolean(),
  review_reasons: z.array(z.string()),
  customer: z.object({ full_name: z.string(), phone_e164: z.string(), whatsapp_opt_in_at: z.string().nullable() }),
  passengers: z.array(
    z.object({
      full_name: z.string(),
      passenger_type: z.enum(["ADULT", "CHILD", "INFANT"]),
      room_type: z.enum(["DOUBLE", "SINGLE"]),
    }),
  ),
  flight_segments: z.array(
    z.object({ airline: z.string(), origin_iata: z.string(), dest_iata: z.string(), departs_at: z.string() }),
  ),
  // La relación reserva -> plan es uno-a-uno: puede llegar como objeto, lista o null
  payment_plans: zeroOrMany(
    z.object({
      id: z.string(),
      status: z.string(),
      frequency: z.string(),
      final_due_date: z.string(),
      installments: z.array(
        z.object({
          sequence: z.number(),
          kind: z.string(),
          amount_cents: z.number(),
          paid_cents: z.number(),
          due_date: z.string(),
          status: z.string(),
        }),
      ),
    }),
  ),
  payments: z.array(
    z.object({
      id: z.string(),
      amount_cents: z.number(),
      unapplied_cents: z.number(),
      method: z.string(),
      status: z.string(),
      bank_reference: z.string().nullable(),
      created_at: z.string(),
    }),
  ),
});

export type BookingDetail = z.infer<typeof bookingDetailSchema>;
