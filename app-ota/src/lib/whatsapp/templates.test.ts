import { describe, expect, test } from "vitest";
import { reminderMessage as construir, type ReminderContext } from "./templates";
import type { ReminderKind } from "../reminders";

// Versión de la función que falla si no hay mensaje (para las pruebas que sí esperan uno)
function reminderMessage(kind: ReminderKind, ctx: ReminderContext) {
  const m = construir(kind, ctx);
  if (!m) throw new Error(`Se esperaba un mensaje para ${kind}`);
  return m;
}

const base = {
  customerName: "María Pérez",
  bookingCode: "OTA-1001",
  sequence: 2,
  amountDueCents: 18750,
  currency: "USD" as const,
  dueDate: "2026-10-18",
};

describe("reminderMessage", () => {
  test("UPCOMING usa la plantilla recordatorio_cuota con 5 parámetros", () => {
    const m = reminderMessage("UPCOMING", base);
    expect(m.templateName).toBe("recordatorio_cuota");
    expect(m.bodyParams).toEqual(["María", "2", "US$ 187.50", "18/10/2026", "OTA-1001"]);
  });

  test("usa solo el primer nombre del cliente", () => {
    expect(reminderMessage("UPCOMING", base).bodyParams[0]).toBe("María");
  });

  test("OVERDUE_1, OVERDUE_3 y OVERDUE_7 usan la plantilla cuota_vencida", () => {
    for (const kind of ["OVERDUE_1", "OVERDUE_3", "OVERDUE_7"] as const) {
      const m = reminderMessage(kind, base);
      expect(m.templateName).toBe("cuota_vencida");
      expect(m.bodyParams).toEqual(["2", "18/10/2026"]);
    }
  });

  test("DEFAULT no genera mensaje: lo decide un agente", () => {
    expect(construir("DEFAULT", base)).toBeNull();
  });

  test("si el nombre está vacío usa un saludo neutro", () => {
    expect(reminderMessage("UPCOMING", { ...base, customerName: "  " }).bodyParams[0]).toBe("cliente");
  });
});
