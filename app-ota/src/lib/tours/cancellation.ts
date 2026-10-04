// Políticas de cancelación de un tour.
// Una política es una lista de reglas "si faltan N días o más para la salida, se reembolsa X %".
// Se aplica la regla de MAYOR anticipación que se cumpla; con menos días que la última regla, no hay reembolso.
// La política se COPIA a cada reserva al venderla (así cambiarla después no altera lo que ya se prometió).

import type { Cents } from "../money";

export interface CancellationRule {
  minDaysBefore: number; // 0 a 365
  refundPercent: number; // 0 a 100
}

export class CancellationPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CancellationPolicyError";
  }
}

const MAX_RULES = 10;
const MAX_DAYS = 365;

function esEntero(valor: unknown, min: number, max: number): valor is number {
  return typeof valor === "number" && Number.isInteger(valor) && valor >= min && valor <= max;
}

// Valida y devuelve las reglas ordenadas de más a menos anticipación
export function validateRules(entrada: unknown): CancellationRule[] {
  if (!Array.isArray(entrada) || entrada.length === 0 || entrada.length > MAX_RULES) {
    throw new CancellationPolicyError(`La política debe tener entre 1 y ${MAX_RULES} reglas`);
  }

  const reglas = entrada.map((r): CancellationRule => {
    const candidata = r as Partial<CancellationRule> | null;
    if (
      !candidata ||
      !esEntero(candidata.minDaysBefore, 0, MAX_DAYS) ||
      !esEntero(candidata.refundPercent, 0, 100)
    ) {
      throw new CancellationPolicyError(
        `Cada regla necesita días de anticipación (0 a ${MAX_DAYS}) y porcentaje de reembolso (0 a 100), enteros`,
      );
    }
    return { minDaysBefore: candidata.minDaysBefore, refundPercent: candidata.refundPercent };
  });

  reglas.sort((a, b) => b.minDaysBefore - a.minDaysBefore);

  for (let i = 1; i < reglas.length; i++) {
    if (reglas[i].minDaysBefore === reglas[i - 1].minDaysBefore) {
      throw new CancellationPolicyError("Hay dos reglas con los mismos días de anticipación");
    }
    // Más cerca de la salida nunca puede devolverse MÁS dinero
    if (reglas[i].refundPercent > reglas[i - 1].refundPercent) {
      throw new CancellationPolicyError("El reembolso no puede aumentar cuando se acerca la fecha de salida");
    }
  }
  return reglas;
}

// Porcentaje que se reembolsa si se cancela faltando "daysBefore" días (negativo = ya pasó la salida)
export function refundPercentFor(reglas: readonly CancellationRule[], daysBefore: number): number {
  if (daysBefore < 0) return 0;
  const aplicables = reglas.filter((r) => daysBefore >= r.minDaysBefore);
  if (aplicables.length === 0) return 0;
  return aplicables.reduce((mejor, r) => (r.minDaysBefore > mejor.minDaysBefore ? r : mejor)).refundPercent;
}

// Reembolso en centavos. Se redondea HACIA ABAJO: nunca se devuelve más de lo que dice la política.
export function computeRefund(paidCents: Cents, percent: number): Cents {
  if (!Number.isInteger(paidCents) || paidCents < 0) {
    throw new CancellationPolicyError("Lo pagado debe ser un entero de centavos mayor o igual a cero");
  }
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new CancellationPolicyError("El porcentaje debe estar entre 0 y 100");
  }
  return Math.floor((paidCents * percent) / 100);
}

// Política copiada en una reserva ({ name, rules }) -> datos validados, o null si falta o es inválida
export function rulesFromSnapshot(copia: unknown): { name: string; rules: CancellationRule[] } | null {
  if (typeof copia !== "object" || copia === null) return null;
  const { name, rules } = copia as { name?: unknown; rules?: unknown };
  if (typeof name !== "string") return null;
  try {
    return { name, rules: validateRules(rules) };
  } catch {
    return null;
  }
}

const dias = (n: number) => (n === 1 ? "1 día" : `${n} días`);
const reembolso = (p: number) => (p === 0 ? "sin reembolso" : `reembolso del ${p} %`);

// Texto para el cliente (web, cotización y voucher)
export function describePolicy(reglas: readonly CancellationRule[]): string[] {
  const ordenadas = [...reglas].sort((a, b) => b.minDaysBefore - a.minDaysBefore);
  const lineas: string[] = [];

  ordenadas.forEach((regla, i) => {
    const anterior = ordenadas[i - 1];
    if (i === 0) {
      lineas.push(`Con ${dias(regla.minDaysBefore)} o más de anticipación: ${reembolso(regla.refundPercent)}.`);
    } else if (regla.minDaysBefore === 0) {
      lineas.push(`Con menos de ${dias(anterior.minDaysBefore)} de anticipación: ${reembolso(regla.refundPercent)}.`);
    } else {
      lineas.push(
        `Entre ${regla.minDaysBefore} y ${anterior.minDaysBefore - 1} días antes de la salida: ${reembolso(regla.refundPercent)}.`,
      );
    }
  });

  const ultima = ordenadas[ordenadas.length - 1];
  if (ultima.minDaysBefore > 0 && ultima.refundPercent > 0) {
    lineas.push(`Con menos de ${dias(ultima.minDaysBefore)} de anticipación: sin reembolso.`);
  }
  return lineas;
}
