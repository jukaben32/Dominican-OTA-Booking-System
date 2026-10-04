import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { todayInSantoDomingo } from "../../dates";
import type { GatewayStore } from "../../services/gateway-service";

const bookingSchema = z.object({
  id: z.string(),
  currency: z.enum(["USD", "DOP"]),
  status: z.string(),
  total_cents: z.number(),
  passengers: z.array(z.object({ full_name: z.string() })),
  flight_segments: z.array(z.object({ departs_at: z.string() })),
});

export function createSupabaseGatewayStore(db: SupabaseClient): GatewayStore {
  return {
    async findBookingByCode(code) {
      const { data, error } = await db
        .from("bookings")
        .select("id, currency, status, total_cents, passengers(full_name), flight_segments(departs_at)")
        .eq("code", code)
        .maybeSingle();
      if (error) throw new Error(`No se pudo leer la reserva: ${error.message}`);
      if (!data) return null;

      const reserva = bookingSchema.parse(data);
      // La salida más próxima, como día del calendario DOMINICANO (la base guarda hora UTC: una salida
      // de madrugada UTC sería otro día en Santo Domingo)
      const salidas = reserva.flight_segments.map((s) => todayInSantoDomingo(new Date(s.departs_at))).sort();
      return {
        id: reserva.id,
        currency: reserva.currency,
        status: reserva.status,
        totalCents: reserva.total_cents,
        passengerNames: reserva.passengers.map((p) => p.full_name),
        departureDate: salidas[0] ?? null,
      };
    },

    async flagForReview(bookingId, reasons) {
      const { error } = await db
        .from("bookings")
        .update({ requires_review: true, review_reasons: reasons })
        .eq("id", bookingId);
      if (error) throw new Error(`No se pudo marcar la reserva para revisión: ${error.message}`);
    },

    async logEvent(action, entityId, details) {
      const { error } = await db
        .from("audit_log")
        .insert({ action, entity: "bookings", entity_id: entityId, details });
      if (error) throw new Error(`No se pudo escribir la auditoría: ${error.message}`);
    },
  };
}
