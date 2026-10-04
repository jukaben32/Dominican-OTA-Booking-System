// Política de aprobación de pagos (separación de funciones).
// Un agente puede aprobar pagos hasta un límite; por encima, solo un administrador.
// Así un solo agente (o una sesión robada) no puede dar por bueno un comprobante falso de gran valor.
// ⚠️ SUPUESTO: los límites son un punto de partida; el dueño debe ajustarlos a su operación.

import type { Cents, Currency } from "./money";

export const AGENT_APPROVAL_LIMIT_CENTS: Record<Currency, Cents> = {
  USD: 150_000, // US$ 1,500
  DOP: 9_000_000, // RD$ 90,000 (equivale a ~US$ 1,500 con la tasa supuesta de 60)
};

export function canApprovePayment(role: "ADMIN" | "AGENT", amountCents: Cents, currency: Currency): boolean {
  if (role === "ADMIN") return true;
  return amountCents <= AGENT_APPROVAL_LIMIT_CENTS[currency];
}
