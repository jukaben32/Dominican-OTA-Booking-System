import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProofFile } from "../proofs";

const BUCKET = "payment-proofs";

// Sube el comprobante al bucket PRIVADO con la llave de servicio.
// La ruta la decide el servidor (reserva + nombre aleatorio): el nombre del archivo del usuario nunca se usa.
export async function uploadProof(db: SupabaseClient, bookingId: string, proof: ProofFile): Promise<string> {
  const path = `proofs/${bookingId}/${randomUUID()}.${proof.ext}`;
  const { error } = await db.storage.from(BUCKET).upload(path, proof.bytes, { contentType: proof.mime, upsert: false });
  if (error) throw new Error(`No se pudo subir el comprobante: ${error.message}`);
  return path;
}

// Borra un comprobante que quedó huérfano (el pago no se registró). Un fallo aquí no debe tapar el error original.
export async function removeProof(db: SupabaseClient, path: string): Promise<void> {
  await db.storage.from(BUCKET).remove([path]).catch(() => undefined);
}
