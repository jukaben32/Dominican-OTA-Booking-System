import { describe, expect, test } from "vitest";
import { z } from "zod";
import { zeroOrMany } from "./relations";

const esquema = zeroOrMany(z.object({ id: z.string() }));

describe("zeroOrMany", () => {
  test("una lista se queda como lista", () => {
    expect(esquema.parse([{ id: "a" }, { id: "b" }])).toEqual([{ id: "a" }, { id: "b" }]);
  });

  test("un objeto suelto (relación uno-a-uno) se vuelve lista de uno", () => {
    expect(esquema.parse({ id: "a" })).toEqual([{ id: "a" }]);
  });

  test("null (sin relación) se vuelve lista vacía", () => {
    expect(esquema.parse(null)).toEqual([]);
  });

  test("una lista vacía se queda vacía", () => {
    expect(esquema.parse([])).toEqual([]);
  });

  test("rechaza formas inesperadas", () => {
    expect(esquema.safeParse("texto").success).toBe(false);
    expect(esquema.safeParse([{ otro: 1 }]).success).toBe(false);
  });
});
