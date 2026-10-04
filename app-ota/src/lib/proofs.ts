// Validación de comprobantes de pago (foto o PDF del comprobante de transferencia).
// Se decide por el CONTENIDO real del archivo, nunca por su nombre ni por el tipo que declara el navegador.
// No se aceptan SVG, HTML ni otros formatos que puedan traer scripts.

import { detectImageType } from "./images";

export const MAX_PROOF_BYTES = 5 * 1024 * 1024; // 5 MB

export type ProofValidation =
  | { ok: true; ext: "jpg" | "png" | "webp" | "pdf"; mime: "image/jpeg" | "image/png" | "image/webp" | "application/pdf" }
  | { ok: false; error: string };

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

export function validateProofUpload(bytes: Uint8Array): ProofValidation {
  if (bytes.length === 0) return { ok: false, error: "El archivo está vacío" };
  if (bytes.length > MAX_PROOF_BYTES) {
    return { ok: false, error: `El comprobante supera el máximo de ${MAX_PROOF_BYTES / 1024 / 1024} MB` };
  }
  const imagen = detectImageType(bytes);
  if (imagen) return { ok: true, ...imagen };
  if (PDF.every((b, i) => bytes[i] === b)) return { ok: true, ext: "pdf", mime: "application/pdf" };
  return { ok: false, error: "El comprobante debe ser una foto (JPG, PNG o WebP) o un PDF" };
}

export type ProofFile = { bytes: Uint8Array; ext: "jpg" | "png" | "webp" | "pdf"; mime: string };
export type ProofFromForm = { ok: true; proof: ProofFile | null } | { ok: false; error: string };

// Lee el campo de archivo de un formulario. Sin archivo elegido → proof null (no es error).
// Con archivo → se valida por su contenido real.
export async function readProofFromForm(entry: FormDataEntryValue | null): Promise<ProofFromForm> {
  if (!(entry instanceof File) || entry.size === 0) return { ok: true, proof: null };
  // Se rechaza por tamaño ANTES de leerlo entero en memoria
  if (entry.size > MAX_PROOF_BYTES) {
    return { ok: false, error: `El comprobante supera el máximo de ${MAX_PROOF_BYTES / 1024 / 1024} MB` };
  }
  const bytes = new Uint8Array(await entry.arrayBuffer());
  const validacion = validateProofUpload(bytes);
  if (!validacion.ok) return { ok: false, error: validacion.error };
  return { ok: true, proof: { bytes, ext: validacion.ext, mime: validacion.mime } };
}
