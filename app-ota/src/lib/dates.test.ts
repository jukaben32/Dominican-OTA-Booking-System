import { describe, expect, test } from "vitest";
import { addDays, addMonths, diffDays, isIsoDate, isoToSantoDomingoLocal, santoDomingoLocalToIso, todayInSantoDomingo } from "./dates";

describe("todayInSantoDomingo", () => {
  test("a las 02:00 UTC todavía es el día anterior en República Dominicana (UTC-4)", () => {
    expect(todayInSantoDomingo(new Date("2026-10-05T02:00:00Z"))).toBe("2026-10-04");
  });

  test("a las 12:00 UTC ya es el mismo día", () => {
    expect(todayInSantoDomingo(new Date("2026-10-05T12:00:00Z"))).toBe("2026-10-05");
  });
});

describe("fechas inválidas", () => {
  test("rechaza fechas que no están en formato AAAA-MM-DD (ej. una marca de tiempo con hora)", () => {
    for (const mala of ["2026-12-01T03:00:00Z", "01/12/2026", "", "2026-13-40", "hola"]) {
      expect(() => addDays(mala, 1)).toThrow(/fecha/i);
      expect(() => diffDays(mala, "2026-10-04")).toThrow(/fecha/i);
    }
  });
});

describe("addDays", () => {
  test("suma días cruzando de mes", () => {
    expect(addDays("2026-10-28", 5)).toBe("2026-11-02");
  });

  test("resta días con números negativos", () => {
    expect(addDays("2026-11-02", -5)).toBe("2026-10-28");
  });
});

describe("addMonths", () => {
  test("suma un mes normal", () => {
    expect(addMonths("2026-10-15", 1)).toBe("2026-11-15");
  });

  test("ajusta al último día del mes (31 de enero + 1 mes)", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });

  test("cruza de año", () => {
    expect(addMonths("2026-12-10", 2)).toBe("2027-02-10");
  });
});

describe("diffDays", () => {
  test("cuenta días entre dos fechas", () => {
    expect(diffDays("2026-10-01", "2026-10-04")).toBe(3);
  });

  test("devuelve negativo si la segunda fecha es anterior", () => {
    expect(diffDays("2026-10-04", "2026-10-01")).toBe(-3);
  });
});

describe("santoDomingoLocalToIso", () => {
  test("interpreta la hora escrita como hora de República Dominicana (UTC-4)", () => {
    expect(santoDomingoLocalToIso("2026-12-20T12:00")).toBe("2026-12-20T16:00:00.000Z");
  });

  test("cruza al día siguiente en UTC cuando la hora dominicana es tarde", () => {
    expect(santoDomingoLocalToIso("2026-12-20T22:30")).toBe("2026-12-21T02:30:00.000Z");
  });

  test("acepta segundos opcionales", () => {
    expect(santoDomingoLocalToIso("2026-12-20T12:00:30")).toBe("2026-12-20T16:00:30.000Z");
  });

  test("rechaza formatos inválidos y fechas imposibles", () => {
    for (const malo of ["", "2026-12-20", "20/12/2026 12:00", "2026-13-40T10:00", "2026-12-20T25:00", "hola"]) {
      expect(santoDomingoLocalToIso(malo)).toBeNull();
    }
  });
});

describe("isIsoDate", () => {
  test("acepta fechas reales y rechaza imposibles o con otro formato", () => {
    expect(isIsoDate("2026-10-04")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true); // bisiesto
    for (const mala of ["2026-02-31", "2027-02-29", "2026-13-01", "04/10/2026", "", "hola", "2026-10-04T10:00"]) {
      expect(isIsoDate(mala)).toBe(false);
    }
  });
});

describe("isoToSantoDomingoLocal", () => {
  test("convierte UTC a la hora dominicana para mostrarla en un campo de fecha y hora", () => {
    expect(isoToSantoDomingoLocal("2026-12-20T16:00:00.000Z")).toBe("2026-12-20T12:00");
    expect(isoToSantoDomingoLocal("2026-12-21T02:30:00Z")).toBe("2026-12-20T22:30");
  });

  test("es la operación inversa de santoDomingoLocalToIso", () => {
    const local = "2026-11-05T09:15";
    expect(isoToSantoDomingoLocal(santoDomingoLocalToIso(local)!)).toBe(local);
  });

  test("devuelve vacío si la fecha no es válida (para no romper el formulario)", () => {
    expect(isoToSantoDomingoLocal("hola")).toBe("");
    expect(isoToSantoDomingoLocal("")).toBe("");
  });
});
