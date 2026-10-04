// Servicio que ejecuta el cron diario de cobros:
//   1) actualiza las cuotas vencidas a OVERDUE,
//   2) manda los recordatorios de WhatsApp que toquen hoy (sin repetirlos),
//   3) pasa a DEFAULTED los planes con mora grave (un agente decide qué hacer).
// Usa un "almacén" intercambiable para poder probarse sin base de datos.

import type { IsoDate } from "../dates";
import {
  derivePlanStatus,
  refreshInstallments,
  type InstallmentStatus,
  type PlanInstallment,
  type PlanStatus,
} from "../payment-waterfall";
import { planReminders } from "../reminders";
import { reminderMessage } from "../whatsapp/templates";
import type { WhatsAppSender } from "../whatsapp/ycloud";
import type { Currency } from "../money";

export interface OpenPlan {
  planId: string;
  planStatus: PlanStatus; // estado actual guardado (para saber si hay que actualizarlo)
  bookingId: string;
  bookingCode: string;
  currency: Currency;
  customerId: string;
  customerName: string;
  customerPhone: string; // E.164
  whatsappOptIn: boolean; // ¿aceptó recibir mensajes por WhatsApp?
  installments: PlanInstallment[];
}

export interface MessageClaim {
  id: string;
  shouldSend: boolean;
}

export interface ReminderStore {
  // Planes ACTIVE u OVERDUE (no los completados, cancelados ni en mora grave)
  listOpenPlans(): Promise<OpenPlan[]>;
  // Cada cambio lleva el estado ANTERIOR ("from"): solo se aplica si la cuota sigue así. Si mientras
  // tanto llegó un pago y la cuota pasó a PAID, el cron NO la pisa.
  saveInstallmentStatuses(
    planId: string,
    items: { sequence: number; from: InstallmentStatus; to: InstallmentStatus }[],
    plan: { from: PlanStatus; to: PlanStatus },
  ): Promise<void>;
  markPlanDefaulted(planId: string): Promise<void>;
  // Reserva el derecho a enviar: devuelve shouldSend=false si ya se envió (evita duplicados).
  // Si el intento anterior FALLÓ, devuelve shouldSend=true para reintentar.
  claimMessage(input: {
    dedupeKey: string;
    customerId: string;
    bookingId: string;
    templateName: string;
  }): Promise<MessageClaim>;
  finishMessage(
    messageId: string,
    result: { status: "SENT" | "FAILED"; providerMessageId?: string; error?: string },
  ): Promise<void>;
}

// Un mensaje reservado se puede reintentar si el intento anterior FALLÓ, o si quedó "en cola" tanto tiempo
// que el proceso que lo reservó seguramente murió (por ejemplo, se acabó el tiempo de la función).
export const STALE_QUEUED_MINUTES = 15;

export function isClaimRetryable(status: string, createdAtMs: number, nowMs: number): boolean {
  if (status === "FAILED") return true;
  return status === "QUEUED" && nowMs - createdAtMs > STALE_QUEUED_MINUTES * 60_000;
}

export interface ReminderSummary {
  plansChecked: number;
  sent: number;
  failed: number;
  skippedNoOptIn: number;
  skippedDuplicate: number;
  defaulted: number;
  errors: { planId: string; message: string }[];
}

interface RunInput {
  store: ReminderStore;
  sender: WhatsAppSender;
  today: IsoDate;
}

export async function runReminders({ store, sender, today }: RunInput): Promise<ReminderSummary> {
  const resumen: ReminderSummary = {
    plansChecked: 0,
    sent: 0,
    failed: 0,
    skippedNoOptIn: 0,
    skippedDuplicate: 0,
    defaulted: 0,
    errors: [],
  };

  const planes = await store.listOpenPlans();

  for (const plan of planes) {
    resumen.plansChecked++;
    // Un plan con problemas no debe frenar a los demás
    try {
      await procesarPlan(plan, store, sender, today, resumen);
    } catch (error) {
      resumen.errors.push({
        planId: plan.planId,
        message: error instanceof Error ? error.message : "error desconocido",
      });
    }
  }
  return resumen;
}

async function procesarPlan(
  plan: OpenPlan,
  store: ReminderStore,
  sender: WhatsAppSender,
  today: IsoDate,
  resumen: ReminderSummary,
): Promise<void> {
  // 1) Estados al día (PENDING -> OVERDUE si ya venció)
  const actualizadas = refreshInstallments(plan.installments, today);
  const cambios = actualizadas.flatMap((c, i) =>
    c.status !== plan.installments[i].status
      ? [{ sequence: c.sequence, from: plan.installments[i].status, to: c.status }]
      : [],
  );
  // El estado del plan se recalcula SIEMPRE: una cuota vencida con pago parcial sigue PARTIAL pero el plan
  // debe pasar a OVERDUE aunque ninguna cuota cambie de estado.
  const estadoPlan = derivePlanStatus(actualizadas, today);
  if (cambios.length > 0 || estadoPlan !== plan.planStatus) {
    await store.saveInstallmentStatuses(plan.planId, cambios, { from: plan.planStatus, to: estadoPlan });
  }

  // 2) Recordatorios de hoy
  for (const recordatorio of planReminders(actualizadas, today)) {
    if (recordatorio.kind === "DEFAULT") {
      await store.markPlanDefaulted(plan.planId);
      resumen.defaulted++;
      return; // mora grave: no se siguen mandando mensajes automáticos
    }

    const cuota = actualizadas.find((c) => c.sequence === recordatorio.sequence);
    if (!cuota) continue;

    const mensaje = reminderMessage(recordatorio.kind, {
      customerName: plan.customerName,
      bookingCode: plan.bookingCode,
      sequence: cuota.sequence,
      amountDueCents: cuota.amountCents - cuota.paidCents,
      currency: plan.currency,
      dueDate: cuota.dueDate,
    });
    if (!mensaje) continue;

    // Sin consentimiento no se escribe por WhatsApp (política de Meta y Ley 172-13)
    if (!plan.whatsappOptIn) {
      resumen.skippedNoOptIn++;
      continue;
    }

    const reserva = await store.claimMessage({
      dedupeKey: `reminder:${plan.planId}:${cuota.sequence}:${recordatorio.kind}`,
      customerId: plan.customerId,
      bookingId: plan.bookingId,
      templateName: mensaje.templateName,
    });
    if (!reserva.shouldSend) {
      resumen.skippedDuplicate++;
      continue;
    }

    const envio = await sender.sendTemplate({
      to: plan.customerPhone,
      templateName: mensaje.templateName,
      bodyParams: mensaje.bodyParams,
    });

    if (envio.ok) {
      await store.finishMessage(reserva.id, { status: "SENT", providerMessageId: envio.providerMessageId });
      resumen.sent++;
    } else {
      await store.finishMessage(reserva.id, { status: "FAILED", error: envio.error });
      resumen.failed++;
    }
  }
}
