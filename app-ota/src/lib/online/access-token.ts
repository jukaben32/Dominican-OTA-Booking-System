// Enlace secreto del cliente para ver su reserva en línea (sin cuenta ni contraseña).
// El token tiene 256 bits y no se puede adivinar. En la base de datos SOLO se guarda su huella SHA-256,
// así que aunque alguien lea la tabla no puede reconstruir los enlaces.

import { createHash, createHmac } from "node:crypto";

const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/; // 32 bytes en base64url, sin relleno

export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// El token se DERIVA del identificador del formulario con un secreto del servidor (HMAC-SHA256 = 256 bits).
// Así, si el cliente envía el formulario dos veces, los dos envíos producen el MISMO enlace (no se pierde);
// y sin el secreto nadie puede calcular el enlace de otra persona.
export function deriveAccessToken(formToken: string, secret: string): { token: string; hash: string } {
  const token = createHmac("sha256", secret).update(`online-link:${formToken}`, "utf8").digest("base64url");
  return { token, hash: hashAccessToken(token) };
}

// Descarta de entrada lo que no puede ser un token (evita consultar la base con basura)
export function isValidTokenFormat(token: string): boolean {
  return TOKEN_FORMAT.test(token);
}

// Huella de una clave de límite de intentos (IP, teléfono, enlace): nunca se guarda el dato en claro
export function attemptKey(scope: string, value: string): string {
  return createHash("sha256").update(`${scope}:${value}`, "utf8").digest("hex");
}

// IP del visitante según el proxy de la plataforma. Se prefieren las cabeceras que Vercel fija él mismo;
// "x-forwarded-for" va al final porque, fuera de una plataforma que la sobrescriba, el cliente puede inventarla.
// null = no se sabe (entonces el límite por IP no se aplica, para no bloquear a todos con una clave común).
export function clientIp(headers: Headers): string | null {
  const valor = headers.get("x-vercel-forwarded-for") ?? headers.get("x-real-ip") ?? headers.get("x-forwarded-for");
  return valor?.split(",")[0]?.trim() || null;
}
