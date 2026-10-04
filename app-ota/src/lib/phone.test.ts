import { describe, expect, test } from "vitest";
import { normalizePhone } from "./phone";

describe("normalizePhone", () => {
  test("convierte teléfonos dominicanos de 10 dígitos (809, 829, 849) a E.164", () => {
    expect(normalizePhone("8095550100")).toBe("+18095550100");
    expect(normalizePhone("829-555-0100")).toBe("+18295550100");
    expect(normalizePhone("(849) 555 0100")).toBe("+18495550100");
  });

  test("acepta el 1 inicial con o sin +", () => {
    expect(normalizePhone("18095550100")).toBe("+18095550100");
    expect(normalizePhone("+1 809 555 0100")).toBe("+18095550100");
    expect(normalizePhone("1-809-555-0100")).toBe("+18095550100");
  });

  test("acepta números de EE. UU. de la diáspora (212, 305, 787...)", () => {
    expect(normalizePhone("(212) 555-0100")).toBe("+12125550100");
    expect(normalizePhone("787 555 0100")).toBe("+17875550100");
  });

  test("acepta números internacionales completos con +", () => {
    expect(normalizePhone("+34 612 345 678")).toBe("+34612345678");
  });

  test("rechaza lo que no es un teléfono", () => {
    for (const malo of ["", "abc", "123", "555-0100", "+0123456789", "+1", "0095550100", "80955501001234567"]) {
      expect(normalizePhone(malo)).toBeNull();
    }
  });

  test("rechaza letras o símbolos raros dentro del número (en vez de descartarlos en silencio)", () => {
    for (const malo of ["+34 abc 612345678", "809-555-01OO", "8095550100 ext 5", "+1 (809) 555-0100 x", "tel: 8095550100"]) {
      expect(normalizePhone(malo)).toBeNull();
    }
  });

  test("no adivina el país de números internacionales sin +", () => {
    // 12 dígitos sin + no son un número norteamericano: se rechaza en vez de inventar
    expect(normalizePhone("346123456789")).toBeNull();
  });
});
