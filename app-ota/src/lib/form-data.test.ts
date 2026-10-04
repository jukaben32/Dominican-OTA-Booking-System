import { describe, expect, test } from "vitest";
import { formToRaw } from "./form-data";

describe("formToRaw", () => {
  test("convierte los campos de texto en un objeto", () => {
    const f = new FormData();
    f.set("titulo", "Hola");
    f.set("cupo", "20");
    expect(formToRaw(f)).toEqual({ titulo: "Hola", cupo: "20" });
  });

  test("ignora los archivos (se validan aparte, por su contenido)", () => {
    const f = new FormData();
    f.set("nombre", "x");
    f.set("foto", new File([new Uint8Array([1, 2, 3])], "foto.jpg", { type: "image/jpeg" }));
    expect(formToRaw(f)).toEqual({ nombre: "x" });
  });

  test("si un campo se repite, gana el último", () => {
    const f = new FormData();
    f.append("a", "1");
    f.append("a", "2");
    expect(formToRaw(f).a).toBe("2");
  });

  test("un formulario vacío da un objeto vacío", () => {
    expect(formToRaw(new FormData())).toEqual({});
  });
});
