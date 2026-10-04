// Verificación de firmas y secretos para webhooks y tareas programadas.
// Todas las comparaciones son de TIEMPO CONSTANTE para no filtrar información por tiempos.

import { createHmac, timingSafeEqual } from "node:crypto";

// Comparación segura de dos textos (devuelve false, no lanza error, si el largo difiere)
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

// Firma HMAC-SHA256 en hexadecimal
export function signHmacHex(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

// Valida "Authorization: Bearer <secreto>" (así llama Vercel Cron a nuestras rutas)
export function verifyBearer(header: string | null, secret: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  return safeEqual(header.slice("Bearer ".length), secret);
}

const DEFAULT_TOLERANCE_SECONDS = 300; // 5 minutos

interface TimestampedSignatureInput {
  rawBody: string;
  header: string | null;
  secret: string;
  nowSeconds: number;
  toleranceSeconds?: number;
}

// Firma con marca de tiempo: encabezado "t=<unix>,s=<hex>" donde s = HMAC-SHA256(secret, "<t>.<cuerpo>").
// La usa YCloud (encabezado "YCloud-Signature") y también nuestro webhook de pagos.
// Rechazamos firmas viejas para impedir que alguien reenvíe un aviso capturado (repetición).
export function verifyTimestampedSignature(input: TimestampedSignatureInput): boolean {
  if (!input.header) return false;

  // Las partes sin "=" se ignoran (en vez de generar claves basura)
  const partes = new Map(
    input.header
      .split(",")
      .filter((p) => p.includes("="))
      .map((p) => {
        const i = p.indexOf("=");
        return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
      }),
  );
  const t = partes.get("t");
  const s = partes.get("s");
  if (!t || !s || !/^\d+$/.test(t)) return false;

  const tolerancia = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(input.nowSeconds - Number(t)) > tolerancia) return false;

  return safeEqual(signHmacHex(`${t}.${input.rawBody}`, input.secret), s);
}
