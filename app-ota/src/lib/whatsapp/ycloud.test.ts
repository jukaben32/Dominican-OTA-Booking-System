import { describe, expect, test, vi } from "vitest";
import { createYCloudSender, parseYCloudEvent } from "./ycloud";

const CONFIG = { apiKey: "ycloud-key-prueba", from: "+18095550100" };

function respuesta(status: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
}

describe("createYCloudSender.sendTemplate", () => {
  test("envía la plantilla con el formato oficial de YCloud", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuesta(200, { id: "msg1", wamid: "wamid.ABC" }));
    const sender = createYCloudSender({ ...CONFIG, fetchImpl: fetchFalso });

    const r = await sender.sendTemplate({
      to: "+18295550111",
      templateName: "recordatorio_cuota",
      bodyParams: ["María", "2", "US$ 250.00", "18/10/2026", "OTA-1001"],
    });

    expect(r).toEqual({ ok: true, providerMessageId: "wamid.ABC" });
    const [url, init] = fetchFalso.mock.calls[0];
    expect(url).toBe("https://api.ycloud.com/v2/whatsapp/messages/sendDirectly");
    expect(init.method).toBe("POST");
    expect(init.headers["X-API-Key"]).toBe(CONFIG.apiKey);
    expect(JSON.parse(init.body)).toEqual({
      from: "+18095550100",
      to: "+18295550111",
      type: "template",
      template: {
        name: "recordatorio_cuota",
        language: { code: "es", policy: "deterministic" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "María" },
              { type: "text", text: "2" },
              { type: "text", text: "US$ 250.00" },
              { type: "text", text: "18/10/2026" },
              { type: "text", text: "OTA-1001" },
            ],
          },
        ],
      },
    });
  });

  test("incluye el documento como encabezado de la plantilla (voucher)", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuesta(200, { id: "msg2" }));
    const sender = createYCloudSender({ ...CONFIG, fetchImpl: fetchFalso });

    await sender.sendTemplate({
      to: "+18295550111",
      templateName: "voucher_listo",
      bodyParams: ["María", "ABC123"],
      headerDocument: { link: "https://ejemplo.test/doc.pdf?token=firmado", filename: "Voucher.pdf" },
    });

    const cuerpo = JSON.parse(fetchFalso.mock.calls[0][1].body);
    expect(cuerpo.template.components[0]).toEqual({
      type: "header",
      parameters: [{ type: "document", document: { link: "https://ejemplo.test/doc.pdf?token=firmado", filename: "Voucher.pdf" } }],
    });
    expect(cuerpo.template.components[1].type).toBe("body");
  });

  test("usa el id interno si YCloud no devuelve wamid", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuesta(200, { id: "msg-interno" }));
    const sender = createYCloudSender({ ...CONFIG, fetchImpl: fetchFalso });
    const r = await sender.sendTemplate({ to: "+18295550111", templateName: "x", bodyParams: [] });
    expect(r).toEqual({ ok: true, providerMessageId: "msg-interno" });
  });

  test("devuelve ok:false (sin lanzar) si YCloud responde con error", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuesta(400, { error: { message: "plantilla no aprobada" } }));
    const sender = createYCloudSender({ ...CONFIG, fetchImpl: fetchFalso });
    const r = await sender.sendTemplate({ to: "+18295550111", templateName: "x", bodyParams: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("400");
  });

  test("devuelve ok:false si falla la red, y el error no incluye la llave", async () => {
    const fetchFalso = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const sender = createYCloudSender({ ...CONFIG, fetchImpl: fetchFalso });
    const r = await sender.sendTemplate({ to: "+18295550111", templateName: "x", bodyParams: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toContain(CONFIG.apiKey);
  });

  test("rechaza números que no están en formato E.164 sin llamar a la red", async () => {
    const fetchFalso = vi.fn();
    const sender = createYCloudSender({ ...CONFIG, fetchImpl: fetchFalso });
    const r = await sender.sendTemplate({ to: "809-555-0111", templateName: "x", bodyParams: [] });
    expect(r.ok).toBe(false);
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});

describe("createYCloudSender.sendDocument", () => {
  test("envía un documento con el formato oficial", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuesta(200, { id: "d1", wamid: "wamid.DOC" }));
    const sender = createYCloudSender({ ...CONFIG, fetchImpl: fetchFalso });

    const r = await sender.sendDocument({
      to: "+18295550111",
      link: "https://ejemplo.test/cotizacion.pdf?token=firmado",
      filename: "Cotizacion.pdf",
      caption: "Tu cotización",
    });

    expect(r.ok).toBe(true);
    expect(JSON.parse(fetchFalso.mock.calls[0][1].body)).toEqual({
      from: "+18095550100",
      to: "+18295550111",
      type: "document",
      document: { link: "https://ejemplo.test/cotizacion.pdf?token=firmado", filename: "Cotizacion.pdf", caption: "Tu cotización" },
    });
  });
});

describe("parseYCloudEvent", () => {
  test("reconoce un mensaje entrante y normaliza el teléfono a E.164", () => {
    const e = parseYCloudEvent({
      id: "evt_1",
      type: "whatsapp.inbound_message.received",
      apiVersion: "v2",
      createTime: "2026-10-04T12:00:00.000Z",
      whatsappInboundMessage: {
        id: "m1",
        wamid: "wamid.IN",
        from: "18295550111",
        customerProfile: { name: "María" },
        to: "18095550100",
        type: "text",
        text: { body: "Hola, quiero viajar a Santo Domingo" },
      },
    });
    expect(e).toEqual({
      kind: "inbound",
      eventId: "evt_1",
      wamid: "wamid.IN",
      from: "+18295550111",
      name: "María",
      text: "Hola, quiero viajar a Santo Domingo",
    });
  });

  test("acepta un teléfono que ya viene con +", () => {
    const e = parseYCloudEvent({
      id: "evt_2",
      type: "whatsapp.inbound_message.received",
      whatsappInboundMessage: { wamid: "w", from: "+18295550111", type: "text", text: { body: "hi" } },
    });
    expect(e.kind === "inbound" && e.from).toBe("+18295550111");
  });

  test("un mensaje entrante que no es texto se reporta sin texto", () => {
    const e = parseYCloudEvent({
      id: "evt_3",
      type: "whatsapp.inbound_message.received",
      whatsappInboundMessage: { wamid: "w", from: "18295550111", type: "image" },
    });
    expect(e.kind === "inbound" && e.text).toBeUndefined();
  });

  test("reconoce una actualización de estado", () => {
    const e = parseYCloudEvent({
      id: "evt_4",
      type: "whatsapp.message.updated",
      whatsappMessage: { wamid: "wamid.OUT", status: "delivered" },
    });
    expect(e).toEqual({ kind: "status", eventId: "evt_4", wamid: "wamid.OUT", status: "delivered", error: undefined });
  });

  test("reconoce un fallo y conserva el mensaje de error", () => {
    const e = parseYCloudEvent({
      id: "evt_5",
      type: "whatsapp.message.updated",
      whatsappMessage: { wamid: "wamid.OUT", status: "failed", errorCode: "131047", errorMessage: "ventana de 24h cerrada" },
    });
    expect(e.kind === "status" && e.error).toBe("131047: ventana de 24h cerrada");
  });

  test("un teléfono inválido se ignora (si no, la base lo rechaza y YCloud reintentaría para siempre)", () => {
    for (const from of ["123", "abc", "", "+0123456789", "1".repeat(20)]) {
      const e = parseYCloudEvent({
        id: "evt_7",
        type: "whatsapp.inbound_message.received",
        whatsappInboundMessage: { wamid: "w", from, type: "text", text: { body: "hola" } },
      });
      expect(e).toEqual({ kind: "ignored", eventId: "evt_7" });
    }
  });

  test("ignora eventos de otro tipo sin lanzar error", () => {
    expect(parseYCloudEvent({ id: "evt_6", type: "whatsapp.template.reviewed" })).toEqual({ kind: "ignored", eventId: "evt_6" });
  });

  test("ignora basura que no es un evento", () => {
    expect(parseYCloudEvent(null)).toEqual({ kind: "ignored" });
    expect(parseYCloudEvent("texto")).toEqual({ kind: "ignored" });
    expect(parseYCloudEvent({ type: 5 })).toEqual({ kind: "ignored" });
  });
});
