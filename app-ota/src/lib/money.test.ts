import { describe, expect, test } from "vitest";
import { formatMoney, percentOf, toCents, convertCents, parseMoneyInput } from "./money";

describe("toCents", () => {
  test("convierte 485.40 a 48540 sin errores de decimales", () => {
    expect(toCents(485.4)).toBe(48540);
  });

  test("evita el error clásico de 0.1 + 0.2", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
  });

  test("lanza error si el monto no es un número finito", () => {
    expect(() => toCents(Number.NaN)).toThrow();
    expect(() => toCents(Infinity)).toThrow();
  });
});

describe("percentOf", () => {
  test("calcula 25 % de 100000 centavos", () => {
    expect(percentOf(100000, 25)).toBe(25000);
  });

  test("redondea hacia arriba en la mitad (half up)", () => {
    // 18 % de 3 centavos = 0.54 -> 1
    expect(percentOf(3, 18)).toBe(1);
  });
});

describe("convertCents", () => {
  test("convierte USD a DOP con la tasa fijada", () => {
    // US$ 485.40 * 60.00 = RD$ 29,124.00
    expect(convertCents(48540, 60)).toBe(2912400);
  });

  test("rechaza tasas inválidas", () => {
    expect(() => convertCents(100, 0)).toThrow();
    expect(() => convertCents(100, -5)).toThrow();
  });
});

describe("formatMoney", () => {
  test("formatea dólares", () => {
    expect(formatMoney(48540, "USD")).toBe("US$ 485.40");
  });

  test("formatea pesos con separador de miles", () => {
    expect(formatMoney(2912400, "DOP")).toBe("RD$ 29,124.00");
  });
});

describe("parseMoneyInput", () => {
  test("acepta montos normales y los pasa a centavos", () => {
    expect(parseMoneyInput("450")).toBe(45000);
    expect(parseMoneyInput("450.5")).toBe(45050);
    expect(parseMoneyInput("450.05")).toBe(45005);
    expect(parseMoneyInput("0")).toBe(0);
  });

  test("acepta comas como separador de miles y espacios alrededor", () => {
    expect(parseMoneyInput(" 1,250.50 ")).toBe(125050);
    expect(parseMoneyInput("12,345,678.90")).toBe(1234567890);
  });

  test("no sufre errores de punto flotante (19.99, 0.29)", () => {
    expect(parseMoneyInput("19.99")).toBe(1999);
    expect(parseMoneyInput("0.29")).toBe(29);
  });

  test("rechaza lo que no es un monto válido", () => {
    for (const malo of ["", "abc", "-5", "1.234", "1,25", "1,2345.00", "12.", ".5", "1e5", "US$ 5", "5 000"]) {
      expect(parseMoneyInput(malo)).toBeNull();
    }
  });

  test("rechaza montos absurdamente grandes", () => {
    expect(parseMoneyInput("999999999")).toBeNull();
  });
});
