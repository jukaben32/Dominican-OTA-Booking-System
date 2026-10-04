// Utilidades de dinero.
// REGLA DE ORO: todo el dinero se guarda en CENTAVOS ENTEROS (US$ 485.40 = 48540).
// Nunca usamos decimales (float) para sumar dinero porque 0.1 + 0.2 no da 0.3 en JavaScript.

export type Cents = number;
export type Currency = "USD" | "DOP";

// Convierte un monto con decimales (ej. 485.4) a centavos enteros (48540)
export function toCents(amount: number): Cents {
  if (!Number.isFinite(amount)) {
    throw new Error("El monto debe ser un número finito");
  }
  return Math.round(amount * 100);
}

// Convierte lo que escribe una persona ("1,250.50") a centavos enteros. Devuelve null si no es un monto válido.
// Se hace con el texto (sin pasar por decimales) para evitar errores de punto flotante.
const MAX_MONEY_INPUT_CENTS = 100_000_000_00; // 100 millones
const MONEY_PATTERN = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/;

export function parseMoneyInput(texto: string): Cents | null {
  const limpio = texto.trim();
  if (!MONEY_PATTERN.test(limpio)) return null;
  const [enteros, decimales = ""] = limpio.replace(/,/g, "").split(".");
  const centavos = Number(enteros) * 100 + Number(decimales.padEnd(2, "0"));
  return centavos <= MAX_MONEY_INPUT_CENTS ? centavos : null;
}

// Calcula un porcentaje de un monto en centavos, redondeando hacia arriba en la mitad
export function percentOf(cents: Cents, percent: number): Cents {
  return Math.round((cents * percent) / 100);
}

// Convierte centavos de una moneda a otra usando una tasa fija (ej. USD -> DOP a 60.00)
export function convertCents(cents: Cents, rate: number): Cents {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("La tasa de cambio debe ser mayor que cero");
  }
  return Math.round(cents * rate);
}

// Símbolos que se muestran al cliente
const SYMBOLS: Record<Currency, string> = { USD: "US$", DOP: "RD$" };

// Formatea centavos para mostrar: 48540 + "USD" -> "US$ 485.40"
export function formatMoney(cents: Cents, currency: Currency): string {
  const texto = (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${SYMBOLS[currency]} ${texto}`;
}
