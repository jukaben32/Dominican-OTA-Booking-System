import { describe, expect, test } from "vitest";
import { planReminders } from "./reminders";
import type { PlanInstallment } from "./payment-waterfall";

function cuota(dueDate: string, status: PlanInstallment["status"], sequence = 1): PlanInstallment {
  return { sequence, amountCents: 25000, paidCents: 0, dueDate, status };
}

describe("planReminders", () => {
  test("avisa 3 días antes del vencimiento", () => {
    const r = planReminders([cuota("2026-10-07", "PENDING")], "2026-10-04");
    expect(r).toEqual([{ sequence: 1, kind: "UPCOMING" }]);
  });

  test("no avisa en otros días previos", () => {
    expect(planReminders([cuota("2026-10-09", "PENDING")], "2026-10-04")).toEqual([]);
  });

  test("avisa a 1, 3 y 7 días de mora", () => {
    expect(planReminders([cuota("2026-10-03", "OVERDUE")], "2026-10-04")[0].kind).toBe("OVERDUE_1");
    expect(planReminders([cuota("2026-10-01", "OVERDUE")], "2026-10-04")[0].kind).toBe("OVERDUE_3");
    expect(planReminders([cuota("2026-09-27", "OVERDUE")], "2026-10-04")[0].kind).toBe("OVERDUE_7");
  });

  test("a los 10 días de mora o más ordena pasar el plan a DEFAULT", () => {
    const r = planReminders([cuota("2026-09-24", "OVERDUE")], "2026-10-04");
    expect(r).toEqual([{ sequence: 1, kind: "DEFAULT" }]);
  });

  test("no envía nada de las cuotas pagadas o perdonadas", () => {
    expect(planReminders([cuota("2026-10-07", "PAID")], "2026-10-04")).toEqual([]);
    expect(planReminders([cuota("2026-10-03", "WAIVED")], "2026-10-04")).toEqual([]);
  });

  test("las cuotas parciales también se recuerdan", () => {
    const r = planReminders([cuota("2026-10-07", "PARTIAL")], "2026-10-04");
    expect(r[0].kind).toBe("UPCOMING");
  });

  test("procesa varias cuotas a la vez", () => {
    const r = planReminders(
      [cuota("2026-10-07", "PENDING", 1), cuota("2026-10-03", "OVERDUE", 2)],
      "2026-10-04",
    );
    expect(r.map((x) => x.sequence)).toEqual([1, 2]);
  });
});
