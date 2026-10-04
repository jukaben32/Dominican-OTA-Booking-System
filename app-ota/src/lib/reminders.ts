// Decide qué recordatorios de cobro toca enviar HOY (el cron diario llama a esta función).
// Coincide por día exacto: la cuota se recuerda 3 días antes y a 1, 3 y 7 días de mora.
// A los 10 días de mora (o más) se ordena pasar el plan a DEFAULTED.
// Para no repetir mensajes, el que envía debe revisar la tabla whatsapp_messages.

import { diffDays, type IsoDate } from "./dates";
import type { PlanInstallment } from "./payment-waterfall";

export type ReminderKind =
  | "UPCOMING"
  | "OVERDUE_1"
  | "OVERDUE_3"
  | "OVERDUE_7"
  | "DEFAULT";

export interface Reminder {
  sequence: number;
  kind: ReminderKind;
}

const DAYS_BEFORE_DUE = 3;
const DEFAULT_AFTER_DAYS = 10;
const OVERDUE_STEPS: Record<number, ReminderKind> = {
  1: "OVERDUE_1",
  3: "OVERDUE_3",
  7: "OVERDUE_7",
};

export function planReminders(
  installments: readonly PlanInstallment[],
  today: IsoDate,
): Reminder[] {
  const result: Reminder[] = [];

  for (const c of installments) {
    // Solo las cuotas con dinero pendiente
    if (c.status === "PAID" || c.status === "WAIVED") continue;

    const diasParaVencer = diffDays(today, c.dueDate);
    if (diasParaVencer === DAYS_BEFORE_DUE) {
      result.push({ sequence: c.sequence, kind: "UPCOMING" });
      continue;
    }

    const diasDeMora = -diasParaVencer;
    if (diasDeMora >= DEFAULT_AFTER_DAYS) {
      result.push({ sequence: c.sequence, kind: "DEFAULT" });
    } else if (OVERDUE_STEPS[diasDeMora]) {
      result.push({ sequence: c.sequence, kind: OVERDUE_STEPS[diasDeMora] });
    }
  }

  return result;
}
