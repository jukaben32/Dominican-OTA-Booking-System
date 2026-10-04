import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const BUCKET = "payment-proofs";
export const PROOF_RETENTION_DAYS = 60; // los comprobantes de pagos que no se aprobaron se guardan 60 días
const BATCH = 100; // por ejecución diaria; el resto se limpia en los días siguientes

const filaSchema = z.object({ id: z.string(), booking_id: z.string(), proof_path: z.string() });

// Borra del almacenamiento los comprobantes que ya no sirven:
//  - de pagos RECHAZADOS, contando los 60 días desde que se rechazaron, y
//  - de pagos que quedaron "por verificar" en una reserva que venció hace más de 60 días.
// NUNCA se borran: los de pagos APROBADOS (dinero real, prueba contable) ni los de reservas con un reembolso
// pendiente (el cliente pudo haber transferido y el comprobante es la evidencia para devolverle).
// El registro del pago se conserva; solo se quita el archivo (proof_path queda en null).
export async function cleanupOldProofs(db: SupabaseClient, now: Date = new Date()): Promise<{ removed: number }> {
  const limite = new Date(now.getTime() - PROOF_RETENTION_DAYS * 24 * 3600 * 1000).toISOString();

  const { data: rechazados, error: e1 } = await db
    .from("payments")
    .select("id, booking_id, proof_path")
    .not("proof_path", "is", null)
    .eq("status", "REJECTED")
    .lt("verified_at", limite) // sin fecha de rechazo (null) no se borra
    .limit(BATCH);
  if (e1) throw new Error(`No se pudieron buscar comprobantes rechazados: ${e1.message}`);

  const { data: enVencidas, error: e2 } = await db
    .from("payments")
    .select("id, booking_id, proof_path, booking:bookings!inner(status, updated_at)")
    .not("proof_path", "is", null)
    .eq("status", "PENDING_VERIFICATION")
    .eq("bookings.status", "EXPIRED")
    .lt("bookings.updated_at", limite)
    .limit(BATCH);
  if (e2) throw new Error(`No se pudieron buscar comprobantes de reservas vencidas: ${e2.message}`);

  const candidatos = [
    ...z.array(filaSchema).parse(rechazados ?? []),
    ...z.array(filaSchema).parse((enVencidas ?? []).map(({ id, booking_id, proof_path }) => ({ id, booking_id, proof_path }))),
  ].slice(0, BATCH);
  if (candidatos.length === 0) return { removed: 0 };

  // Se excluyen las reservas con reembolso pendiente
  const { data: pendientes, error: e3 } = await db
    .from("refunds")
    .select("booking_id")
    .eq("status", "PENDING")
    .in("booking_id", [...new Set(candidatos.map((c) => c.booking_id))]);
  if (e3) throw new Error(`No se pudieron revisar los reembolsos: ${e3.message}`);
  const protegidas = new Set((pendientes ?? []).map((p) => String(p.booking_id)));
  const aBorrar = candidatos.filter((c) => !protegidas.has(c.booking_id));
  if (aBorrar.length === 0) return { removed: 0 };

  const { error: errorBorrado } = await db.storage.from(BUCKET).remove(aBorrar.map((c) => c.proof_path));
  if (errorBorrado) throw new Error(`No se pudieron borrar los archivos: ${errorBorrado.message}`);

  const { error: errorUpdate } = await db.from("payments").update({ proof_path: null }).in("id", aBorrar.map((c) => c.id));
  if (errorUpdate) throw new Error(`No se pudo actualizar los pagos: ${errorUpdate.message}`);
  return { removed: aBorrar.length };
}
