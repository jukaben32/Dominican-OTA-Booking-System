import { describe, expect, test } from "vitest";
import {
  CancellationPolicyError,
  computeRefund,
  describePolicy,
  refundPercentFor,
  rulesFromSnapshot,
  validateRules,
} from "./cancellation";

// Política típica: 30+ días 90 %, 15 a 29 días 50 %, 7 a 14 días 25 %, menos de 7 días nada
const politica = [
  { minDaysBefore: 30, refundPercent: 90 },
  { minDaysBefore: 15, refundPercent: 50 },
  { minDaysBefore: 7, refundPercent: 25 },
];

describe("validateRules", () => {
  test("acepta una política válida y la devuelve ordenada de más a menos anticipación", () => {
    const desordenada = [politica[2], politica[0], politica[1]];
    expect(validateRules(desordenada)).toEqual(politica);
  });

  test("acepta una política de una sola regla", () => {
    expect(validateRules([{ minDaysBefore: 0, refundPercent: 100 }])).toHaveLength(1);
  });

  test("rechaza lo que no es una lista, una lista vacía o con más de 10 reglas", () => {
    expect(() => validateRules("hola")).toThrow(CancellationPolicyError);
    expect(() => validateRules([])).toThrow(CancellationPolicyError);
    const once = Array.from({ length: 11 }, (_, i) => ({ minDaysBefore: i, refundPercent: 0 }));
    expect(() => validateRules(once)).toThrow(CancellationPolicyError);
  });

  test("rechaza días o porcentajes fuera de rango, decimales o que no son números", () => {
    for (const mala of [
      { minDaysBefore: -1, refundPercent: 50 },
      { minDaysBefore: 366, refundPercent: 50 },
      { minDaysBefore: 10, refundPercent: 101 },
      { minDaysBefore: 10, refundPercent: -5 },
      { minDaysBefore: 10.5, refundPercent: 50 },
      { minDaysBefore: "10", refundPercent: 50 },
      { minDaysBefore: 10 },
      null,
    ]) {
      expect(() => validateRules([mala])).toThrow(CancellationPolicyError);
    }
  });

  test("rechaza dos reglas con los mismos días", () => {
    expect(() =>
      validateRules([
        { minDaysBefore: 10, refundPercent: 50 },
        { minDaysBefore: 10, refundPercent: 20 },
      ]),
    ).toThrow(/mismos días/);
  });

  test("rechaza que el reembolso AUMENTE cuando se acerca la fecha", () => {
    expect(() =>
      validateRules([
        { minDaysBefore: 30, refundPercent: 50 },
        { minDaysBefore: 7, refundPercent: 80 },
      ]),
    ).toThrow(/aumentar/);
  });
});

describe("refundPercentFor", () => {
  test("aplica la regla con más anticipación que se cumple", () => {
    expect(refundPercentFor(politica, 60)).toBe(90);
    expect(refundPercentFor(politica, 30)).toBe(90);
    expect(refundPercentFor(politica, 29)).toBe(50);
    expect(refundPercentFor(politica, 15)).toBe(50);
    expect(refundPercentFor(politica, 14)).toBe(25);
    expect(refundPercentFor(politica, 7)).toBe(25);
  });

  test("con menos días que la última regla no hay reembolso", () => {
    expect(refundPercentFor(politica, 6)).toBe(0);
    expect(refundPercentFor(politica, 0)).toBe(0);
  });

  test("después de la salida no hay reembolso aunque exista una regla de 0 días", () => {
    expect(refundPercentFor([{ minDaysBefore: 0, refundPercent: 100 }], -1)).toBe(0);
    expect(refundPercentFor([{ minDaysBefore: 0, refundPercent: 100 }], 0)).toBe(100);
  });
});

describe("computeRefund", () => {
  test("calcula el reembolso en centavos redondeando a favor de la agencia (hacia abajo)", () => {
    expect(computeRefund(100000, 50)).toBe(50000);
    expect(computeRefund(10001, 50)).toBe(5000); // 5000.5 -> 5000
    expect(computeRefund(99999, 33)).toBe(32999);
  });

  test("0 % no devuelve nada y 100 % devuelve todo", () => {
    expect(computeRefund(123456, 0)).toBe(0);
    expect(computeRefund(123456, 100)).toBe(123456);
  });

  test("nunca devuelve más de lo pagado ni un valor negativo", () => {
    expect(computeRefund(0, 90)).toBe(0);
    expect(() => computeRefund(-1, 50)).toThrow();
    expect(() => computeRefund(1000, 101)).toThrow();
  });
});

describe("describePolicy", () => {
  test("explica la política en español claro, de mayor a menor anticipación", () => {
    expect(describePolicy(politica)).toEqual([
      "Con 30 días o más de anticipación: reembolso del 90 %.",
      "Entre 15 y 29 días antes de la salida: reembolso del 50 %.",
      "Entre 7 y 14 días antes de la salida: reembolso del 25 %.",
      "Con menos de 7 días de anticipación: sin reembolso.",
    ]);
  });

  test("si la última regla cubre hasta el día de salida no agrega la línea final", () => {
    const lineas = describePolicy([
      { minDaysBefore: 10, refundPercent: 100 },
      { minDaysBefore: 0, refundPercent: 20 },
    ]);
    expect(lineas).toEqual([
      "Con 10 días o más de anticipación: reembolso del 100 %.",
      "Con menos de 10 días de anticipación: reembolso del 20 %.",
    ]);
  });

  test("usa singular para 1 día y escribe 'sin reembolso' cuando es 0 %", () => {
    const lineas = describePolicy([{ minDaysBefore: 1, refundPercent: 0 }]);
    expect(lineas).toEqual(["Con 1 día o más de anticipación: sin reembolso."]);
  });
});

describe("rulesFromSnapshot", () => {
  test("lee la política copiada en una reserva", () => {
    const copia = { name: "Estándar", rules: [{ minDaysBefore: 7, refundPercent: 25 }, { minDaysBefore: 30, refundPercent: 90 }] };
    expect(rulesFromSnapshot(copia)).toEqual({
      name: "Estándar",
      rules: [{ minDaysBefore: 30, refundPercent: 90 }, { minDaysBefore: 7, refundPercent: 25 }],
    });
  });

  test("si no hay copia o es inválida devuelve null en vez de romper la pantalla", () => {
    for (const mala of [null, undefined, "texto", {}, { name: "X" }, { name: "X", rules: [] }, { name: "X", rules: [{ minDaysBefore: 1 }] }, { rules: [{ minDaysBefore: 1, refundPercent: 5 }] }]) {
      expect(rulesFromSnapshot(mala)).toBeNull();
    }
  });
});
