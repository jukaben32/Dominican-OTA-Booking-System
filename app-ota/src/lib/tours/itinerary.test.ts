import { describe, expect, test } from "vitest";
import { formatItinerary, ItineraryError, parseItinerary, parseLines } from "./itinerary";

const texto = `Día 1: Llegada a Medellín
Recepción en el aeropuerto y traslado al hotel.
Tarde libre.

Día 2: Comuna 13 y centro
Tour guiado por la Comuna 13.

Día 3: Regreso
Traslado al aeropuerto.`;

describe("parseItinerary", () => {
  test("convierte el texto en días con título y descripción", () => {
    const dias = parseItinerary(texto);
    expect(dias).toHaveLength(3);
    expect(dias[0]).toEqual({
      day: 1,
      title: "Llegada a Medellín",
      description: "Recepción en el aeropuerto y traslado al hotel.\nTarde libre.",
    });
    expect(dias[2].title).toBe("Regreso");
  });

  test("acepta variantes: sin la palabra 'Día', con punto, guion o dos puntos, y mayúsculas", () => {
    const dias = parseItinerary("1. Llegada\nHotel\n\nDIA 2 - Tour\nCentro\n\ndia 3: Salida\nAeropuerto");
    expect(dias.map((d) => d.title)).toEqual(["Llegada", "Tour", "Salida"]);
  });

  test("un día puede no tener descripción", () => {
    expect(parseItinerary("Día 1: Libre")).toEqual([{ day: 1, title: "Libre", description: "" }]);
  });

  test("tolera varias líneas en blanco seguidas y espacios sobrantes", () => {
    const dias = parseItinerary("\n\n  Día 1: Uno  \n  texto  \n\n\n\nDía 2: Dos\n\n");
    expect(dias).toEqual([
      { day: 1, title: "Uno", description: "texto" },
      { day: 2, title: "Dos", description: "" },
    ]);
  });

  test("texto vacío devuelve una lista vacía", () => {
    expect(parseItinerary("")).toEqual([]);
    expect(parseItinerary("   \n\n  ")).toEqual([]);
  });

  test("rechaza un bloque que no empieza con 'Día N: título' y dice cuál", () => {
    expect(() => parseItinerary("Día 1: Uno\nok\n\nesto no es un día")).toThrow(/bloque 2/i);
  });

  test("rechaza días que no son consecutivos desde el 1", () => {
    expect(() => parseItinerary("Día 1: Uno\n\nDía 3: Tres")).toThrow(ItineraryError);
    expect(() => parseItinerary("Día 2: Dos")).toThrow(ItineraryError);
    expect(() => parseItinerary("Día 1: Uno\n\nDía 1: Otra vez")).toThrow(ItineraryError);
  });

  test("rechaza títulos o descripciones demasiado largos y más de 60 días", () => {
    expect(() => parseItinerary(`Día 1: ${"x".repeat(121)}`)).toThrow(ItineraryError);
    expect(() => parseItinerary(`Día 1: Uno\n${"x".repeat(2001)}`)).toThrow(ItineraryError);
    const muchos = Array.from({ length: 61 }, (_, i) => `Día ${i + 1}: Dia`).join("\n\n");
    expect(() => parseItinerary(muchos)).toThrow(ItineraryError);
  });
});

describe("formatItinerary", () => {
  test("es la operación inversa de parseItinerary", () => {
    const dias = parseItinerary(texto);
    expect(parseItinerary(formatItinerary(dias))).toEqual(dias);
  });

  test("lista vacía da texto vacío", () => {
    expect(formatItinerary([])).toBe("");
  });
});

describe("parseLines", () => {
  test("separa por líneas, quita espacios, viñetas y líneas vacías", () => {
    expect(parseLines("  Hotel 3 noches \n\n- Desayunos\n• Traslados\n* Guía")).toEqual([
      "Hotel 3 noches",
      "Desayunos",
      "Traslados",
      "Guía",
    ]);
  });

  test("elimina repetidos sin importar mayúsculas", () => {
    expect(parseLines("Guía\nguía\nHotel")).toEqual(["Guía", "Hotel"]);
  });

  test("rechaza líneas muy largas y demasiadas líneas", () => {
    expect(() => parseLines("x".repeat(201))).toThrow(ItineraryError);
    expect(() => parseLines(Array.from({ length: 41 }, (_, i) => `línea ${i}`).join("\n"))).toThrow(ItineraryError);
  });
});
