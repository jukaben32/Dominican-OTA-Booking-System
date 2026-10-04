import { describe, expect, test } from "vitest";
import type { YCloudEvent } from "../whatsapp/ycloud";
import { handleYCloudEvent, type InboundStore, type MessageStatus } from "./inbound-service";

function crearAlmacen() {
  const eventos = new Set<string>();
  let fallarAlCrearLead = false;
  const clientes = new Map<string, { id: string; name?: string }>();
  const leads: { customerId: string; summary: string }[] = [];
  const entrantes: { customerId: string; wamid: string; preview: string }[] = [];
  const estados = new Map<string, MessageStatus>();
  const errores = new Map<string, string | undefined>();
  let n = 1;

  const almacen: InboundStore = {
    async claimWebhookEvent(_proveedor, eventId) {
      if (eventos.has(eventId)) return false;
      eventos.add(eventId);
      return true;
    },
    async upsertCustomer(phone, name) {
      const existente = clientes.get(phone);
      if (existente) return { id: existente.id, created: false };
      const nuevo = { id: `cli-${n++}`, name };
      clientes.set(phone, nuevo);
      return { id: nuevo.id, created: true };
    },
    async hasOpenLead(customerId) {
      return leads.some((l) => l.customerId === customerId);
    },
    async createLead(customerId, summary) {
      if (fallarAlCrearLead) throw new Error("base de datos caída");
      leads.push({ customerId, summary });
    },
    async releaseWebhookEvent(_proveedor, eventId) {
      eventos.delete(eventId);
    },
    async logInboundMessage(input) {
      entrantes.push({ customerId: input.customerId, wamid: input.providerMessageId, preview: input.preview });
    },
    async getOutboundStatus(wamid) {
      return estados.get(wamid) ?? null;
    },
    async updateOutboundStatus(wamid, status, error) {
      estados.set(wamid, status);
      errores.set(wamid, error);
    },
  };
  return {
    almacen,
    eventos,
    clientes,
    leads,
    entrantes,
    estados,
    errores,
    romperCreacionDeLead: (valor: boolean) => {
      fallarAlCrearLead = valor;
    },
  };
}

// text = null significa "mensaje sin texto" (si usáramos undefined, JavaScript pondría el valor por defecto)
const entrante = (id = "evt_1", text: string | null = "Hola, quiero viajar en diciembre"): YCloudEvent => ({
  kind: "inbound",
  eventId: id,
  wamid: `wamid.${id}`,
  from: "+18295550111",
  name: "María",
  text: text ?? undefined,
});

describe("mensajes entrantes", () => {
  test("un número nuevo crea cliente, lead y registra el mensaje", async () => {
    const f = crearAlmacen();
    const r = await handleYCloudEvent(f.almacen, entrante());
    expect(r).toBe("PROCESSED");
    expect(f.clientes.size).toBe(1);
    expect(f.leads).toHaveLength(1);
    expect(f.entrantes[0].preview).toBe("Hola, quiero viajar en diciembre");
  });

  test("un cliente que ya tiene lead abierto NO crea otro lead", async () => {
    const f = crearAlmacen();
    await handleYCloudEvent(f.almacen, entrante("evt_1"));
    await handleYCloudEvent(f.almacen, entrante("evt_2"));
    expect(f.leads).toHaveLength(1);
    expect(f.entrantes).toHaveLength(2);
  });

  test("el mismo evento entregado dos veces se procesa una sola vez", async () => {
    const f = crearAlmacen();
    expect((await handleYCloudEvent(f.almacen, entrante("evt_1"))) as string).toBe("PROCESSED");
    expect((await handleYCloudEvent(f.almacen, entrante("evt_1"))) as string).toBe("DUPLICATE");
    expect(f.entrantes).toHaveLength(1);
  });

  test("si el procesamiento falla, el reintento de YCloud SÍ se procesa (no se pierde el mensaje)", async () => {
    const f = crearAlmacen();
    f.romperCreacionDeLead(true);
    await expect(handleYCloudEvent(f.almacen, entrante("evt_1"))).rejects.toThrow("base de datos caída");

    f.romperCreacionDeLead(false);
    expect(await handleYCloudEvent(f.almacen, entrante("evt_1"))).toBe("PROCESSED");
    expect(f.leads).toHaveLength(1);
  });

  test("corta el texto largo a 200 caracteres", async () => {
    const f = crearAlmacen();
    await handleYCloudEvent(f.almacen, entrante("evt_1", "x".repeat(500)));
    expect(f.entrantes[0].preview).toHaveLength(200);
  });

  test("un mensaje sin texto (imagen, audio) se registra con una etiqueta", async () => {
    const f = crearAlmacen();
    await handleYCloudEvent(f.almacen, entrante("evt_1", null));
    expect(f.entrantes[0].preview).toBe("[mensaje sin texto]");
  });
});

describe("estados de entrega", () => {
  const estado = (status: string, error?: string): YCloudEvent => ({
    kind: "status",
    eventId: `evt_${status}`,
    wamid: "wamid.OUT",
    status,
    error,
  });

  test("delivered y read avanzan el estado", async () => {
    const f = crearAlmacen();
    f.estados.set("wamid.OUT", "SENT");
    await handleYCloudEvent(f.almacen, estado("delivered"));
    expect(f.estados.get("wamid.OUT")).toBe("DELIVERED");
    await handleYCloudEvent(f.almacen, estado("read"));
    expect(f.estados.get("wamid.OUT")).toBe("READ");
  });

  test("un aviso atrasado NO retrocede el estado (delivered llega después de read)", async () => {
    const f = crearAlmacen();
    f.estados.set("wamid.OUT", "READ");
    await handleYCloudEvent(f.almacen, estado("delivered"));
    expect(f.estados.get("wamid.OUT")).toBe("READ");
  });

  test("failed se registra con el motivo", async () => {
    const f = crearAlmacen();
    f.estados.set("wamid.OUT", "SENT");
    await handleYCloudEvent(f.almacen, estado("failed", "131047: ventana de 24h cerrada"));
    expect(f.estados.get("wamid.OUT")).toBe("FAILED");
    expect(f.errores.get("wamid.OUT")).toBe("131047: ventana de 24h cerrada");
  });

  test("failed NO pisa un mensaje que ya fue entregado", async () => {
    const f = crearAlmacen();
    f.estados.set("wamid.OUT", "DELIVERED");
    await handleYCloudEvent(f.almacen, estado("failed", "tardío"));
    expect(f.estados.get("wamid.OUT")).toBe("DELIVERED");
  });

  test("un mensaje que no conocemos se ignora sin error", async () => {
    const f = crearAlmacen();
    expect(await handleYCloudEvent(f.almacen, estado("delivered"))).toBe("IGNORED");
  });

  test("estados desconocidos de YCloud se ignoran", async () => {
    const f = crearAlmacen();
    f.estados.set("wamid.OUT", "SENT");
    expect(await handleYCloudEvent(f.almacen, estado("raro"))).toBe("IGNORED");
    expect(f.estados.get("wamid.OUT")).toBe("SENT");
  });
});

describe("otros eventos", () => {
  test("los eventos ignorados no hacen nada", async () => {
    const f = crearAlmacen();
    expect(await handleYCloudEvent(f.almacen, { kind: "ignored", eventId: "x" })).toBe("IGNORED");
    expect(f.clientes.size).toBe(0);
  });
});
