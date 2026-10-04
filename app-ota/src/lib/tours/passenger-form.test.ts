import { describe, expect, test } from "vitest";
import { parsePassengerRows } from "./passenger-form";

function formulario(filas: { n?: string; t?: string; b?: string; r?: string }[]): FormData {
  const f = new FormData();
  for (const fila of filas) {
    f.append("pName", fila.n ?? "");
    f.append("pType", fila.t ?? "ADULT");
    f.append("pBirth", fila.b ?? "");
    f.append("pRoom", fila.r ?? "DOUBLE");
  }
  return f;
}

describe("parsePassengerRows", () => {
  test("convierte las filas del formulario en pasajeros", () => {
    const r = parsePassengerRows(formulario([
      { n: "María Pérez", t: "ADULT", r: "SINGLE" },
      { n: "Ana Pérez", t: "CHILD", b: "2018-05-10" },
    ]));
    expect(r).toEqual([
      { name: "María Pérez", type: "ADULT", birthDate: null, room: "SINGLE" },
      { name: "Ana Pérez", type: "CHILD", birthDate: "2018-05-10", room: "DOUBLE" },
    ]);
  });

  test("ignora las filas completamente vacías (las que el agente no usó)", () => {
    const r = parsePassengerRows(formulario([{ n: "María Pérez" }, {}, { n: "   " }, { n: "Juan Pérez" }]));
    expect(r.map((p) => p.name)).toEqual(["María Pérez", "Juan Pérez"]);
  });

  test("conserva una fila con fecha pero sin nombre para que la validación pida el nombre", () => {
    const r = parsePassengerRows(formulario([{ n: "", b: "2018-05-10", t: "CHILD" }]));
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe("");
  });

  test("valores desconocidos de tipo o habitación se dejan tal cual para que la validación los rechace", () => {
    const r = parsePassengerRows(formulario([{ n: "María Pérez", t: "VIEJO", r: "SUITE" }]));
    expect(r[0].type).toBe("VIEJO");
    expect(r[0].room).toBe("SUITE");
  });

  test("más de 20 filas se recortan para no procesar entradas absurdas", () => {
    const muchas = Array.from({ length: 50 }, (_, i) => ({ n: `Pasajero Número ${i}` }));
    expect(parsePassengerRows(formulario(muchas)).length).toBeLessThanOrEqual(20);
  });

  test("sin campos devuelve una lista vacía", () => {
    expect(parsePassengerRows(new FormData())).toEqual([]);
  });

  test("si las columnas vienen desparejas (alguien manipuló el formulario) no se rompe", () => {
    const f = new FormData();
    f.append("pName", "María Pérez");
    f.append("pName", "Juan Pérez");
    f.append("pType", "ADULT");
    const r = parsePassengerRows(f);
    expect(r).toHaveLength(2);
    expect(r[1].type).toBe("ADULT");
  });
});
