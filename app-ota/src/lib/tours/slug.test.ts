import { describe, expect, test } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  test("convierte un título en una dirección web limpia, sin tildes ni símbolos", () => {
    expect(slugify("Medellín: Comuna 13 y Guatapé")).toBe("medellin-comuna-13-y-guatape");
    expect(slugify("¡Panamá, canal y ciudad!")).toBe("panama-canal-y-ciudad");
  });

  test("maneja la ñ y las ü", () => {
    expect(slugify("Año nuevo en Cartagena")).toBe("ano-nuevo-en-cartagena");
    expect(slugify("Pingüinos")).toBe("pinguinos");
  });

  test("colapsa espacios y guiones repetidos y quita los de los extremos", () => {
    expect(slugify("  --Hola   ---mundo--  ")).toBe("hola-mundo");
  });

  test("limita el largo a 80 caracteres sin dejar un guion al final", () => {
    const s = slugify("palabra ".repeat(30));
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s.endsWith("-")).toBe(false);
  });

  test("devuelve vacío si no queda nada utilizable (emojis, símbolos)", () => {
    expect(slugify("🌴🌴 !!!")).toBe("");
    expect(slugify("")).toBe("");
  });
});
