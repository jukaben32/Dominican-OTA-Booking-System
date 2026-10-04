import { describe, expect, test } from "vitest";
import { toWinAnsi, wrapText } from "./text";

describe("toWinAnsi", () => {
  test("conserva tildes, ñ, signos de apertura y símbolos que el PDF sí soporta", () => {
    expect(toWinAnsi("Año nuevo en Panamá: ¿cuánto cuesta? ¡Excelente! € – — “comillas” …")).toBe(
      "Año nuevo en Panamá: ¿cuánto cuesta? ¡Excelente! € – — “comillas” …",
    );
  });

  test("reemplaza lo que el PDF no puede dibujar (emojis, otros alfabetos) por '?' sin romper el documento", () => {
    expect(toWinAnsi("Playa 🌴 y sol")).toBe("Playa ? y sol");
    expect(toWinAnsi("日本")).toBe("??");
  });

  test("convierte tabuladores y saltos raros en espacios y conserva el salto de línea normal", () => {
    expect(toWinAnsi("a\tb c")).toBe("a b c");
    expect(toWinAnsi("uno\ndos")).toBe("uno\ndos");
    expect(toWinAnsi("uno\r\ndos")).toBe("uno\ndos");
  });

  test("quita caracteres de control invisibles", () => {
    expect(toWinAnsi("a\u0000b\u0007c")).toBe("abc");
  });
});

// Medidor falso: cada carácter mide 10 puntos
const medir = (s: string) => s.length * 10;

describe("wrapText", () => {
  test("parte un párrafo largo en líneas que caben en el ancho", () => {
    expect(wrapText("uno dos tres cuatro", 100, medir)).toEqual(["uno dos", "tres", "cuatro"]);
  });

  test("respeta los saltos de línea del texto original y las líneas vacías", () => {
    expect(wrapText("uno\n\ndos", 200, medir)).toEqual(["uno", "", "dos"]);
  });

  test("parte una palabra más larga que el ancho en pedazos", () => {
    const lineas = wrapText("abcdefghijklmnop", 50, medir);
    expect(lineas.every((l) => medir(l) <= 50)).toBe(true);
    expect(lineas.join("")).toBe("abcdefghijklmnop");
  });

  test("ninguna línea supera el ancho, para cualquier texto", () => {
    const texto = "Traslado privado del aeropuerto al hotel con asistencia en español, y cena de bienvenida incluida el primer día";
    for (const ancho of [60, 100, 150, 400]) {
      const lineas = wrapText(texto, ancho, medir);
      expect(lineas.every((l) => medir(l) <= ancho)).toBe(true);
      // No se pierde ni se inventa nada de texto (salvo los espacios donde se parte)
      expect(lineas.join("").replace(/\s+/g, "")).toBe(texto.replace(/\s+/g, ""));
    }
  });

  test("texto vacío da una sola línea vacía", () => {
    expect(wrapText("", 100, medir)).toEqual([""]);
  });

  test("rechaza un ancho no positivo", () => {
    expect(() => wrapText("hola", 0, medir)).toThrow();
  });
});
