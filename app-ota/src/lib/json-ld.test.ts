import { describe, expect, test } from "vitest";
import { serializeJsonLd } from "./json-ld";

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

describe("serializeJsonLd", () => {
  test("un texto con </script> no puede cerrar la etiqueta", () => {
    const salida = serializeJsonLd({ name: "Tour</script><script>alert(1)</script>" });
    expect(salida).not.toContain("</script>");
    expect(salida).not.toContain("<");
  });

  test("sigue siendo JSON válido y recupera el texto original", () => {
    const original = { name: "Tour <b>&</b> más", n: 5, lista: ["a", "b"] };
    expect(JSON.parse(serializeJsonLd(original))).toEqual(original);
  });

  test("escapa los separadores de línea de Unicode y se recuperan intactos", () => {
    const texto = `a${LS}b${PS}c`;
    const salida = serializeJsonLd({ t: texto });
    expect(salida).not.toContain(LS);
    expect(salida).not.toContain(PS);
    expect(JSON.parse(salida).t).toBe(texto);
  });
});
