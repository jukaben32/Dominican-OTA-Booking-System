import { describe, expect, test } from "vitest";
import { formatDateTime, formatDay } from "./format";

describe("formatDay", () => {
  test("pasa AAAA-MM-DD a DD/MM/AAAA sin convertir zonas horarias", () => {
    expect(formatDay("2026-10-18")).toBe("18/10/2026");
  });

  test("ignora la hora si viene una marca de tiempo completa", () => {
    expect(formatDay("2026-12-01T03:00:00Z")).toBe("01/12/2026");
  });
});

describe("formatDateTime", () => {
  test("muestra la hora de República Dominicana (UTC-4)", () => {
    // 11:40 UTC = 7:40 a. m. en Santo Domingo
    expect(formatDateTime("2026-12-10T11:40:00Z")).toMatch(/7:40/);
  });

  test("el día cambia según el horario dominicano (02:00 UTC es la noche anterior)", () => {
    expect(formatDateTime("2026-12-11T02:00:00Z")).toMatch(/10/);
  });
});
