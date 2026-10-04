// Cliente de la API oficial de WhatsApp Business a través de YCloud (proveedor oficial de Meta).
// Formatos verificados en la documentación de YCloud (docs.ycloud.com) el 2026-10-04.
// Si el día de mañana se cambia a la Cloud API directa de Meta, solo hay que crear otra
// implementación de la interfaz WhatsAppSender: el resto de la app no se entera.

import { z } from "zod";

const YCLOUD_SEND_URL = "https://api.ycloud.com/v2/whatsapp/messages/sendDirectly";
const REQUEST_TIMEOUT_MS = 10_000;
const E164 = /^\+[1-9]\d{7,14}$/;

export type SendResult =
  | { ok: true; providerMessageId: string | undefined }
  | { ok: false; error: string };

export interface SendTemplateInput {
  to: string; // E.164, ej. +18295550111
  templateName: string;
  languageCode?: string; // por defecto "es"
  bodyParams: readonly string[];
  headerDocument?: { link: string; filename: string };
}

export interface SendDocumentInput {
  to: string;
  link: string; // URL FIRMADA y temporal (el bucket es privado)
  filename: string;
  caption?: string;
}

// Interfaz que usa el resto de la app (permite cambiar de proveedor y simular en pruebas)
export interface WhatsAppSender {
  sendTemplate(input: SendTemplateInput): Promise<SendResult>;
  sendDocument(input: SendDocumentInput): Promise<SendResult>;
}

interface YCloudConfig {
  apiKey: string;
  from: string; // número emisor E.164
  fetchImpl?: typeof fetch;
}

export function createYCloudSender(config: YCloudConfig): WhatsAppSender {
  const doFetch = config.fetchImpl ?? fetch;

  async function post(body: unknown): Promise<SendResult> {
    try {
      const res = await doFetch(YCLOUD_SEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": config.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        // No devolvemos el cuerpo completo: podría traer datos del cliente
        return { ok: false, error: `YCloud respondió ${res.status}` };
      }
      const json = (await res.json().catch(() => ({}))) as { id?: string; wamid?: string };
      return { ok: true, providerMessageId: json.wamid ?? json.id };
    } catch (error) {
      // Mensaje genérico: nunca incluimos la llave ni los encabezados
      const motivo = error instanceof Error ? error.name : "desconocido";
      return { ok: false, error: `No se pudo contactar a YCloud (${motivo})` };
    }
  }

  return {
    async sendTemplate(input) {
      if (!E164.test(input.to)) return { ok: false, error: "Número de destino inválido (usa formato E.164)" };

      const components: unknown[] = [];
      if (input.headerDocument) {
        components.push({
          type: "header",
          parameters: [{ type: "document", document: input.headerDocument }],
        });
      }
      components.push({
        type: "body",
        parameters: input.bodyParams.map((text) => ({ type: "text", text })),
      });

      return post({
        from: config.from,
        to: input.to,
        type: "template",
        template: {
          name: input.templateName,
          language: { code: input.languageCode ?? "es", policy: "deterministic" },
          components,
        },
      });
    },

    async sendDocument(input) {
      if (!E164.test(input.to)) return { ok: false, error: "Número de destino inválido (usa formato E.164)" };
      return post({
        from: config.from,
        to: input.to,
        type: "document",
        document: { link: input.link, filename: input.filename, caption: input.caption },
      });
    },
  };
}

// ---------------------------------------------------------------------
// Eventos que YCloud nos manda por webhook
// ---------------------------------------------------------------------

export type YCloudEvent =
  | { kind: "inbound"; eventId: string; wamid: string; from: string; name: string | undefined; text: string | undefined }
  | { kind: "status"; eventId: string; wamid: string; status: string; error: string | undefined }
  | { kind: "ignored"; eventId?: string };

const inboundSchema = z.object({
  id: z.string(),
  type: z.literal("whatsapp.inbound_message.received"),
  whatsappInboundMessage: z.object({
    wamid: z.string(),
    from: z.string(),
    customerProfile: z.object({ name: z.string().optional() }).optional(),
    type: z.string().optional(),
    text: z.object({ body: z.string() }).optional(),
  }),
});

const statusSchema = z.object({
  id: z.string(),
  type: z.literal("whatsapp.message.updated"),
  whatsappMessage: z.object({
    wamid: z.string(),
    status: z.string(),
    errorCode: z.union([z.string(), z.number()]).optional(),
    errorMessage: z.string().optional(),
  }),
});

// YCloud puede mandar el teléfono con o sin "+": lo normalizamos siempre a E.164
function toE164(raw: string): string {
  return `+${raw.replace(/\D/g, "")}`;
}

export function parseYCloudEvent(payload: unknown): YCloudEvent {
  const inbound = inboundSchema.safeParse(payload);
  if (inbound.success) {
    const m = inbound.data.whatsappInboundMessage;
    const from = toE164(m.from);
    // Un teléfono que no cumple E.164 no se puede guardar: se ignora (200) en vez de provocar reintentos infinitos
    if (!E164.test(from)) return { kind: "ignored", eventId: inbound.data.id };
    return {
      kind: "inbound",
      eventId: inbound.data.id,
      wamid: m.wamid,
      from,
      name: m.customerProfile?.name,
      text: m.text?.body,
    };
  }

  const status = statusSchema.safeParse(payload);
  if (status.success) {
    const m = status.data.whatsappMessage;
    return {
      kind: "status",
      eventId: status.data.id,
      wamid: m.wamid,
      status: m.status,
      error: m.errorMessage ? `${m.errorCode ?? "?"}: ${m.errorMessage}` : undefined,
    };
  }

  const id = (payload as { id?: unknown } | null)?.id;
  return typeof id === "string" ? { kind: "ignored", eventId: id } : { kind: "ignored" };
}
