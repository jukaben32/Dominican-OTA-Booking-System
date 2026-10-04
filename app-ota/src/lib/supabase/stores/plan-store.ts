import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { PaymentPlanError } from "../../payment-plan";
import { zeroOrMany } from "../relations";
import type { PlanStore } from "../../services/plan-service";

const bookingSchema = z.object({
  id: z.string(),
  currency: z.enum(["USD", "DOP"]),
  status: z.string(),
  paid_cents: z.number(),
  total_cents: z.number(),
  price_guaranteed: z.boolean(),
  group_block_id: z.string().nullable(),
  supplier_deadline: z.string().nullable(),
  payment_plans: zeroOrMany(z.object({ id: z.string() })),
});

// Traduce los errores de la función SQL a mensajes claros para el agente
const ERRORES: [string, string][] = [
  ["TARIFA_NO_GARANTIZADA", "El apartado solo aplica con tarifa garantizada"],
  ["RESERVA_NO_ADMITE_PLAN", "Esta reserva ya no admite un plan de pago"],
  ["RESERVA_CON_PAGOS", "La reserva ya tiene pagos"],
  ["YA_TIENE_PLAN", "La reserva ya tiene un plan de pago"],
  ["FALTA_VENCIMIENTO_PROVEEDOR", "Falta el vencimiento del proveedor"],
  ["FECHA_LIMITE_MUY_CERCANA", "La fecha límite deja menos de 7 días antes del vencimiento del proveedor"],
  ["CUOTA_DESPUES_DE_FECHA_LIMITE", "Alguna cuota vence después de la fecha límite"],
  ["CUOTAS_NO_SUMAN_EL_TOTAL", "Las cuotas no suman el total de la reserva"],
  ["CUOTAS_INVALIDAS", "El plan debe tener al menos el abono y una cuota"],
  ["PAGOS_PREVIOS", "La reserva ya tiene pagos registrados (pendientes o aplicados): no se puede crear un plan"],
  ["ABONO_INVALIDO", "El abono inicial debe ser la primera cuota y estar entre el 20 % y el 50 % del total"],
  ["RESERVA_NO_EXISTE", "La reserva no existe"],
];

export function createSupabasePlanStore(db: SupabaseClient): PlanStore {
  return {
    async getBooking(bookingId) {
      const { data, error } = await db
        .from("bookings")
        .select("id, currency, status, paid_cents, total_cents, price_guaranteed, group_block_id, supplier_deadline, payment_plans(id)")
        .eq("id", bookingId)
        .maybeSingle();
      if (error) throw new Error(`No se pudo leer la reserva: ${error.message}`);
      if (!data) return null;

      const r = bookingSchema.parse(data);
      return {
        id: r.id,
        currency: r.currency,
        status: r.status,
        paidCents: r.paid_cents,
        totalCents: r.total_cents,
        priceGuaranteed: r.price_guaranteed,
        hasGroupBlock: r.group_block_id !== null,
        supplierDeadline: r.supplier_deadline,
        hasPlan: r.payment_plans.length > 0,
      };
    },

    async createPlan(args) {
      const { data, error } = await db.rpc("create_payment_plan", {
        p_booking_id: args.bookingId,
        p_frequency: args.frequency,
        p_final_due_date: args.finalDueDate,
        p_installments: args.installments,
        p_actor: args.actorId,
      });
      if (error) {
        const conocido = ERRORES.find(([codigo]) => error.message.includes(codigo));
        throw conocido ? new PaymentPlanError(conocido[1]) : new Error(`No se pudo crear el plan: ${error.message}`);
      }
      return data as string;
    },
  };
}
