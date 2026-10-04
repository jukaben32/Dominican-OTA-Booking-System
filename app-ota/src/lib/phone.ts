// Normaliza el teléfono que escribe un agente al formato internacional E.164 (+18095550100),
// que es el que exige la base de datos y WhatsApp.
// Regla: sin "+", solo se aceptan números norteamericanos (10 dígitos, o 11 con 1 inicial), que cubren
// República Dominicana (809/829/849), EE. UU. y Puerto Rico. Los demás países deben escribirse con "+".

const E164 = /^\+[1-9]\d{7,14}$/;
// En el plan norteamericano el código de área y el de central no pueden empezar en 0 ni en 1
const NORTH_AMERICA_10 = /^[2-9]\d{2}[2-9]\d{6}$/;

// Solo dígitos y los separadores que la gente suele escribir: espacio, guion, punto y paréntesis
const FORMATO_PERMITIDO = /^\+?[\d\s().-]+$/;

export function normalizePhone(texto: string): string | null {
  const limpio = texto.trim();
  if (!limpio || !FORMATO_PERMITIDO.test(limpio)) return null;

  if (limpio.startsWith("+")) {
    const e164 = `+${limpio.replace(/\D/g, "")}`;
    return E164.test(e164) ? e164 : null;
  }

  const digitos = limpio.replace(/\D/g, "");
  if (NORTH_AMERICA_10.test(digitos)) return `+1${digitos}`;
  if (digitos.length === 11 && digitos.startsWith("1") && NORTH_AMERICA_10.test(digitos.slice(1))) {
    return `+${digitos}`;
  }
  return null;
}
