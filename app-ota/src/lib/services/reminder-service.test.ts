import { describe, expect, test } from "vitest";
import type { PlanInstallment } from "../payment-waterfall";
import type { SendResult, WhatsAppSender } from "../whatsapp/ycloud";
import { isClaimRetryable, runReminders, STALE_QUEUED_MINUTES, type OpenPlan, type ReminderStore } from "./reminder-service";

const HOY = "2026-10-04";

function cuota(sequence: number, dueDate: string, extra: Partial<PlanInstallment> = {}): PlanInstallment {
  return { sequence, amountCents: 25000, paidCents: 0, dueDate, status: "PENDING", ...extra };
}

function plan(extra: Partial<OpenPlan> = {}): OpenPlan {
  return {
    planId: "plan-1",
    planStatus: "ACTIVE",
    bookingId: "reserva-1",
    bookingCode: "OTA-1001",
    currency: "USD",
    customerId: "cliente-1",
    customerName: "María Pérez",
    customerPhone: "+18295550111",
    whatsappOptIn: true,
    installments: [cuota(0, "2026-09-20", { paidCents: 25000, status: "PAID" }), cuota(1, "2026-10-07")],
    ...extra,
  };
}

// Almacén falso: reproduce la regla de "un mensaje por clave, salvo si el anterior falló"
function crearAlmacen(planes: OpenPlan[]) {
  const mensajes = new Map<string, { id: string; status: string }>();
  const guardados: {
    planId: string;
    items: { sequence: number; from: string; to: string }[];
    plan: { from: string; to: string };
  }[] = [];
  const defaulted: string[] = [];
  let contador = 1;

  const almacen: ReminderStore = {
    async listOpenPlans() {
      return planes;
    },
    async saveInstallmentStatuses(planId, items, plan) {
      guardados.push({ planId, items: [...items], plan });
    },
    async markPlanDefaulted(planId) {
      defaulted.push(planId);
    },
    async claimMessage({ dedupeKey }) {
      const previo = mensajes.get(dedupeKey);
      if (!previo) {
        const nuevo = { id: `msg-${contador++}`, status: "QUEUED" };
        mensajes.set(dedupeKey, nuevo);
        return { id: nuevo.id, shouldSend: true };
      }
      if (previo.status === "FAILED") {
        previo.status = "QUEUED";
        return { id: previo.id, shouldSend: true };
      }
      return { id: previo.id, shouldSend: false };
    },
    async finishMessage(id, resultado) {
      for (const m of mensajes.values()) if (m.id === id) m.status = resultado.status;
    },
  };
  return { almacen, mensajes, guardados, defaulted };
}

function crearSender(respuesta: SendResult = { ok: true, providerMessageId: "wamid.X" }) {
  const llamadas: { to: string; templateName: string; bodyParams: readonly string[] }[] = [];
  const sender: WhatsAppSender = {
    async sendTemplate(input) {
      llamadas.push({ to: input.to, templateName: input.templateName, bodyParams: input.bodyParams });
      return respuesta;
    },
    async sendDocument() {
      return respuesta;
    },
  };
  return { sender, llamadas };
}

describe("runReminders", () => {
  test("sin planes abiertos no hace nada", async () => {
    const { almacen } = crearAlmacen([]);
    const { sender, llamadas } = crearSender();
    const r = await runReminders({ store: almacen, sender, today: HOY });
    expect(r).toMatchObject({ plansChecked: 0, sent: 0, failed: 0 });
    expect(llamadas).toEqual([]);
  });

  test("envía el recordatorio 3 días antes con los datos correctos", async () => {
    const { almacen } = crearAlmacen([plan()]);
    const { sender, llamadas } = crearSender();

    const r = await runReminders({ store: almacen, sender, today: HOY });

    expect(r.sent).toBe(1);
    expect(llamadas).toEqual([
      {
        to: "+18295550111",
        templateName: "recordatorio_cuota",
        bodyParams: ["María", "1", "US$ 250.00", "07/10/2026", "OTA-1001"],
      },
    ]);
  });

  test("en una cuota parcial recuerda solo lo que falta", async () => {
    const p = plan({ installments: [cuota(1, "2026-10-07", { paidCents: 10000, status: "PARTIAL" })] });
    const { almacen } = crearAlmacen([p]);
    const { sender, llamadas } = crearSender();
    await runReminders({ store: almacen, sender, today: HOY });
    expect(llamadas[0].bodyParams[2]).toBe("US$ 150.00");
  });

  test("NO escribe a clientes que no aceptaron recibir WhatsApp", async () => {
    const { almacen } = crearAlmacen([plan({ whatsappOptIn: false })]);
    const { sender, llamadas } = crearSender();
    const r = await runReminders({ store: almacen, sender, today: HOY });
    expect(llamadas).toEqual([]);
    expect(r.skippedNoOptIn).toBe(1);
  });

  test("no repite el mismo recordatorio si el cron corre dos veces el mismo día", async () => {
    const { almacen } = crearAlmacen([plan()]);
    const { sender, llamadas } = crearSender();
    await runReminders({ store: almacen, sender, today: HOY });
    const segunda = await runReminders({ store: almacen, sender, today: HOY });
    expect(llamadas.length).toBe(1);
    expect(segunda.skippedDuplicate).toBe(1);
  });

  test("si el envío falla lo cuenta y lo vuelve a intentar en la siguiente corrida", async () => {
    const { almacen } = crearAlmacen([plan()]);
    const fallido = crearSender({ ok: false, error: "YCloud respondió 500" });
    const r1 = await runReminders({ store: almacen, sender: fallido.sender, today: HOY });
    expect(r1.failed).toBe(1);

    const bueno = crearSender();
    const r2 = await runReminders({ store: almacen, sender: bueno.sender, today: HOY });
    expect(r2.sent).toBe(1);
  });

  test("a los 3 días de mora usa la plantilla cuota_vencida", async () => {
    const p = plan({ installments: [cuota(1, "2026-10-01")] });
    const { almacen } = crearAlmacen([p]);
    const { sender, llamadas } = crearSender();
    await runReminders({ store: almacen, sender, today: HOY });
    expect(llamadas[0].templateName).toBe("cuota_vencida");
    expect(llamadas[0].bodyParams).toEqual(["1", "01/10/2026"]);
  });

  test("a los 10 días de mora pasa el plan a DEFAULTED y no manda mensaje", async () => {
    const p = plan({ installments: [cuota(1, "2026-09-24")] });
    const { almacen, defaulted } = crearAlmacen([p]);
    const { sender, llamadas } = crearSender();
    const r = await runReminders({ store: almacen, sender, today: HOY });
    expect(defaulted).toEqual(["plan-1"]);
    expect(r.defaulted).toBe(1);
    expect(llamadas).toEqual([]);
  });

  test("actualiza a OVERDUE las cuotas vencidas y el estado del plan", async () => {
    const p = plan({ installments: [cuota(1, "2026-10-02")] });
    const { almacen, guardados } = crearAlmacen([p]);
    const { sender } = crearSender();
    await runReminders({ store: almacen, sender, today: HOY });
    expect(guardados).toEqual([
      {
        planId: "plan-1",
        items: [{ sequence: 1, from: "PENDING", to: "OVERDUE" }],
        plan: { from: "ACTIVE", to: "OVERDUE" },
      },
    ]);
  });

  test("no guarda nada si ningún estado cambió", async () => {
    const { almacen, guardados } = crearAlmacen([plan()]);
    const { sender } = crearSender();
    await runReminders({ store: almacen, sender, today: HOY });
    expect(guardados).toEqual([]);
  });

  test("un error en un plan no detiene a los demás y queda reportado", async () => {
    const malo = plan({ planId: "plan-malo" });
    const bueno = plan({ planId: "plan-bueno", customerPhone: "+18295550222" });
    const { almacen } = crearAlmacen([malo, bueno]);
    const original = almacen.claimMessage;
    almacen.claimMessage = async (input) => {
      if (input.dedupeKey.includes("plan-malo")) throw new Error("falla de base de datos");
      return original(input);
    };
    const { sender, llamadas } = crearSender();

    const r = await runReminders({ store: almacen, sender, today: HOY });

    expect(llamadas.map((l) => l.to)).toEqual(["+18295550222"]);
    expect(r.sent).toBe(1);
    expect(r.errors).toEqual([{ planId: "plan-malo", message: "falla de base de datos" }]);
  });

  test("una cuota vencida con pago PARCIAL pone el plan en OVERDUE aunque ninguna cuota cambie de estado", async () => {
    const p = plan({ installments: [cuota(1, "2026-10-02", { paidCents: 10000, status: "PARTIAL" })] });
    const { almacen, guardados } = crearAlmacen([p]);
    const { sender } = crearSender();
    await runReminders({ store: almacen, sender, today: HOY });
    expect(guardados).toEqual([
      { planId: "plan-1", items: [], plan: { from: "ACTIVE", to: "OVERDUE" } },
    ]);
  });
});

describe("isClaimRetryable", () => {
  const ahora = 1_800_000_000_000;
  const minutos = (n: number) => n * 60_000;

  test("un mensaje FALLIDO siempre se puede reintentar", () => {
    expect(isClaimRetryable("FAILED", ahora, ahora)).toBe(true);
  });

  test("un mensaje en cola reciente NO se reintenta (otro proceso lo está enviando)", () => {
    expect(isClaimRetryable("QUEUED", ahora - minutos(2), ahora)).toBe(false);
  });

  test("un mensaje en cola desde hace mucho SÍ se reintenta (el proceso murió)", () => {
    expect(isClaimRetryable("QUEUED", ahora - minutos(STALE_QUEUED_MINUTES + 1), ahora)).toBe(true);
  });

  test("un mensaje enviado, entregado o leído nunca se reintenta", () => {
    for (const estado of ["SENT", "DELIVERED", "READ"]) {
      expect(isClaimRetryable(estado, ahora - minutos(600), ahora)).toBe(false);
    }
  });
});
