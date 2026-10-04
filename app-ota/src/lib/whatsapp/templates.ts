// Plantillas de WhatsApp que enviamos (deben estar APROBADAS por Meta en YCloud con estos
// mismos nombres y este mismo número de parámetros). Ver plan v2, sección 8.3.

import type { IsoDate } from "../dates";
import { formatMoney, type Cents, type Currency } from "../money";
import type { ReminderKind } from "../reminders";

export interface ReminderContext {
  customerName: string;
  bookingCode: string;
  sequence: number; // número de cuota
  amountDueCents: Cents; // lo que falta por pagar de esa cuota
  currency: Currency;
  dueDate: IsoDate;
}

export interface TemplateMessage {
  templateName: string;
  bodyParams: string[];
}

// "2026-10-18" -> "18/10/2026" (formato dominicano)
function formatDate(fecha: IsoDate): string {
  const [y, m, d] = fecha.split("-");
  return `${d}/${m}/${y}`;
}

function firstName(nombre: string): string {
  return nombre.trim().split(/\s+/)[0] || "cliente";
}

// Devuelve null si ese tipo de recordatorio no se envía por WhatsApp (DEFAULT lo decide un agente)
export function reminderMessage(kind: ReminderKind, ctx: ReminderContext): TemplateMessage | null {
  switch (kind) {
    case "UPCOMING":
      // {{1}} nombre {{2}} cuota {{3}} monto {{4}} fecha {{5}} código de reserva
      return {
        templateName: "recordatorio_cuota",
        bodyParams: [
          firstName(ctx.customerName),
          String(ctx.sequence),
          formatMoney(ctx.amountDueCents, ctx.currency),
          formatDate(ctx.dueDate),
          ctx.bookingCode,
        ],
      };
    case "OVERDUE_1":
    case "OVERDUE_3":
    case "OVERDUE_7":
      // {{1}} cuota {{2}} fecha en que venció
      return {
        templateName: "cuota_vencida",
        bodyParams: [String(ctx.sequence), formatDate(ctx.dueDate)],
      };
    case "DEFAULT":
      return null;
  }
}
