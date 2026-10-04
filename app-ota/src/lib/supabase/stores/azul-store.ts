import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AzulStore } from "../../services/azul-service";
import { zeroOrMany } from "../relations";

const filaSchema = z.object({
  id: z.string(),
  order_number: z.string(),
  booking_id: z.string(),
  amount_cents: z.number(),
  currency: z.enum(["USD", "DOP"]),
  status: z.enum(["pending", "approved", "declined", "cancelled", "error"]),
  booking: zeroOrMany(z.object({ code: z.string() })),
});

// Implementación de AzulStore sobre Supabase (capa fina; la lógica está en azul-service.ts, probado con un almacén falso)
export function createSupabaseAzulStore(db: SupabaseClient): AzulStore {
  return {
    async createTransaction(input) {
      const { error } = await db.from("azul_transactions").insert({
        booking_id: input.bookingId,
        order_number: input.orderNumber,
        amount_cents: input.amountCents,
        currency: input.currency,
      });
      if (error) throw new Error(`No se pudo iniciar la transacción: ${error.message}`);
    },

    async findByOrder(orderNumber) {
      const { data, error } = await db
        .from("azul_transactions")
        .select("id, order_number, booking_id, amount_cents, currency, status, booking:bookings!inner(code)")
        .eq("order_number", orderNumber)
        .maybeSingle();
      if (error) throw new Error(`No se pudo leer la transacción: ${error.message}`);
      if (!data) return null;
      const fila = filaSchema.parse(data);
      const reserva = fila.booking[0];
      if (!reserva) return null;
      return {
        id: fila.id,
        orderNumber: fila.order_number,
        bookingId: fila.booking_id,
        bookingCode: reserva.code,
        amountCents: fila.amount_cents,
        currency: fila.currency,
        status: fila.status,
      };
    },

    async setStatus(id, status, payload) {
      const { error } = await db.from("azul_transactions").update({ status, response_payload: payload }).eq("id", id).in("status", ["pending", "declined"]);
      if (error) throw new Error(`No se pudo actualizar la transacción: ${error.message}`);
    },
  };
}
