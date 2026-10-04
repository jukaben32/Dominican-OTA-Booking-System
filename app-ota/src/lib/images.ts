// Validación de fotos subidas (portadas y galería de los tours).
// Se decide por el CONTENIDO real del archivo ("firma" de los primeros bytes), nunca por su nombre ni por el
// tipo que declara el navegador, porque ambos se pueden falsificar. SVG se rechaza a propósito: puede traer scripts.

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3 MB

export type ImageValidation =
  | { ok: true; ext: "jpg" | "png" | "webp"; mime: "image/jpeg" | "image/png" | "image/webp" }
  | { ok: false; error: string };

const empieza = (bytes: Uint8Array, firma: number[], desde = 0) => firma.every((b, i) => bytes[desde + i] === b);

export type DetectedImage = { ext: "jpg" | "png" | "webp"; mime: "image/jpeg" | "image/png" | "image/webp" };

// Reconoce JPG, PNG y WebP por los primeros bytes del archivo (null si no es ninguno)
export function detectImageType(bytes: Uint8Array): DetectedImage | null {
  if (empieza(bytes, [0xff, 0xd8, 0xff])) return { ext: "jpg", mime: "image/jpeg" };
  if (empieza(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: "png", mime: "image/png" };
  // WebP: "RIFF" .... "WEBP"
  if (empieza(bytes, [0x52, 0x49, 0x46, 0x46]) && empieza(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { ext: "webp", mime: "image/webp" };
  }
  return null;
}

export function validateImageUpload(bytes: Uint8Array): ImageValidation {
  if (bytes.length === 0) return { ok: false, error: "El archivo está vacío" };
  if (bytes.length > MAX_IMAGE_BYTES) {
    return { ok: false, error: `La imagen supera el máximo de ${MAX_IMAGE_BYTES / 1024 / 1024} MB` };
  }
  const tipo = detectImageType(bytes);
  return tipo ? { ok: true, ...tipo } : { ok: false, error: "Solo se aceptan imágenes JPG, PNG o WebP" };
}
