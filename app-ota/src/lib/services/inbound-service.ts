// Atiende los eventos que YCloud manda por webhook:
//   - mensaje entrante  -> crea/actualiza el cliente, abre un lead si no hay uno y guarda el mensaje
//   - estado de entrega -> actualiza el estado del mensaje que enviamos (sin retroceder)
// Cada evento se procesa UNA sola vez aunque YCloud lo reenvíe (reintentos).

import type { YCloudEvent } from "../whatsapp/ycloud";

export type MessageStatus = "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED";
export type InboundResult = "PROCESSED" | "DUPLICATE" | "IGNORED";

export interface InboundStore {
  // true si es la primera vez que vemos este evento
  claimWebhookEvent(provider: string, eventId: string): Promise<boolean>;
  // Quita la marca de "ya procesado" (se usa si el procesamiento falla, para que el reintento funcione)
  releaseWebhookEvent(provider: string, eventId: string): Promise<void>;
  upsertCustomer(phone: string, name: string | undefined): Promise<{ id: string; created: boolean }>;
  hasOpenLead(customerId: string): Promise<boolean>;
  createLead(customerId: string, summary: string): Promise<void>;
  logInboundMessage(input: { customerId: string; providerMessageId: string; preview: string }): Promise<void>;
  getOutboundStatus(providerMessageId: string): Promise<MessageStatus | null>;
  updateOutboundStatus(providerMessageId: string, status: MessageStatus, error?: string): Promise<void>;
}

const PROVIDER = "ycloud";
const PREVIEW_MAX_CHARS = 200;
const NO_TEXT_LABEL = "[mensaje sin texto]";

// Orden de avance de un mensaje saliente (un aviso atrasado no debe retroceder el estado)
const RANK: Record<MessageStatus, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };

const STATUS_MAP: Record<string, MessageStatus> = {
  accepted: "SENT",
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

export async function handleYCloudEvent(store: InboundStore, event: YCloudEvent): Promise<InboundResult> {
  if (event.kind === "ignored") return "IGNORED";

  // Idempotencia: si ya procesamos este evento, no hacemos nada
  if (!(await store.claimWebhookEvent(PROVIDER, event.eventId))) return "DUPLICATE";

  try {
    return await procesar(store, event);
  } catch (error) {
    // Si falló a medias, soltamos la marca: así el reintento de YCloud no se confunde con un duplicado
    await store.releaseWebhookEvent(PROVIDER, event.eventId);
    throw error;
  }
}

async function procesar(
  store: InboundStore,
  event: Exclude<YCloudEvent, { kind: "ignored" }>,
): Promise<InboundResult> {
  if (event.kind === "inbound") {
    // OJO: escribirnos NO significa que aceptó recibir mensajes de la agencia.
    // El consentimiento (whatsapp_opt_in_at) lo registra el agente al cerrar la venta.
    const cliente = await store.upsertCustomer(event.from, event.name);
    if (!(await store.hasOpenLead(cliente.id))) {
      await store.createLead(cliente.id, (event.text ?? NO_TEXT_LABEL).slice(0, PREVIEW_MAX_CHARS));
    }
    await store.logInboundMessage({
      customerId: cliente.id,
      providerMessageId: event.wamid,
      preview: (event.text ?? NO_TEXT_LABEL).slice(0, PREVIEW_MAX_CHARS),
    });
    return "PROCESSED";
  }

  // Estado de entrega
  const nuevo = STATUS_MAP[event.status];
  if (!nuevo) return "IGNORED";

  const actual = await store.getOutboundStatus(event.wamid);
  if (!actual) return "IGNORED"; // no es un mensaje nuestro

  // Un "failed" tardío no pisa un mensaje que ya llegó; un "delivered" tardío no pisa un "read"
  const yaEntregado = RANK[actual] >= RANK.DELIVERED;
  const avanza = nuevo === "FAILED" ? !yaEntregado : RANK[nuevo] > RANK[actual];
  if (avanza) await store.updateOutboundStatus(event.wamid, nuevo, event.error);
  return "PROCESSED";
}
