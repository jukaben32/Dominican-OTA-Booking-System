// Señales de riesgo de fraude ANTES de emitir un boleto pagado con tarjeta.
// No bloquea la venta: marca la reserva para que un agente la revise manualmente.

import { diffDays, type IsoDate } from "./dates";
import type { Cents } from "./money";

export type FraudReason =
  | "SALIDA_PROXIMA"
  | "TITULAR_NO_ES_PASAJERO"
  | "TARJETA_EXTRANJERA_MONTO_ALTO"
  | "MUCHOS_INTENTOS"
  | "CUENTA_NUEVA";

export interface FraudInput {
  today: IsoDate;
  departureDate: IsoDate;
  cardHolderName: string;
  passengerNames: readonly string[];
  cardCountry: string; // código de país de la tarjeta, ej. "DO", "US"
  amountCents: Cents; // en centavos de USD
  paymentAttempts: number;
  accountAgeHours: number;
}

export interface FraudAssessment {
  requiresReview: boolean;
  reasons: FraudReason[];
}

// Umbrales (ajustables según la experiencia real de contracargos)
const DEPARTURE_DAYS_LIMIT = 3; // ~72 horas; se usa <= 3 días para ser conservadores
const FOREIGN_CARD_HIGH_AMOUNT_CENTS = 150_000; // US$ 1,500
const MAX_ATTEMPTS_BEFORE_REVIEW = 3;
const NEW_ACCOUNT_HOURS = 24;
const LOCAL_COUNTRY = "DO";

// Quita tildes, pasa a minúsculas y colapsa espacios para comparar nombres
function normalizeName(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function assessFraudRisk(input: FraudInput): FraudAssessment {
  const reasons: FraudReason[] = [];

  if (diffDays(input.today, input.departureDate) <= DEPARTURE_DAYS_LIMIT) {
    reasons.push("SALIDA_PROXIMA");
  }

  const titular = normalizeName(input.cardHolderName);
  const esPasajero = input.passengerNames.some((p) => normalizeName(p) === titular);
  if (!esPasajero) reasons.push("TITULAR_NO_ES_PASAJERO");

  if (
    input.cardCountry.toUpperCase() !== LOCAL_COUNTRY &&
    input.amountCents >= FOREIGN_CARD_HIGH_AMOUNT_CENTS
  ) {
    reasons.push("TARJETA_EXTRANJERA_MONTO_ALTO");
  }

  if (input.paymentAttempts >= MAX_ATTEMPTS_BEFORE_REVIEW) reasons.push("MUCHOS_INTENTOS");
  if (input.accountAgeHours < NEW_ACCOUNT_HOURS) reasons.push("CUENTA_NUEVA");

  return { requiresReview: reasons.length > 0, reasons };
}
