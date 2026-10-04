import { afterEach, describe, expect, test, vi } from "vitest";

// company.ts lee el entorno al cargarse, así que reiniciamos los módulos en cada prueba
async function cargar() {
  vi.resetModules();
  return import("./company");
}

afterEach(() => vi.unstubAllEnvs());

describe("COMPANY", () => {
  test("sin RUT configurado no inventa ninguna licencia", async () => {
    vi.stubEnv("NEXT_PUBLIC_MITUR_RUT", "");
    const { COMPANY } = await cargar();
    expect(COMPANY.miturRut).toBeNull();
  });

  test("con RUT configurado lo expone sin espacios sobrantes", async () => {
    vi.stubEnv("NEXT_PUBLIC_MITUR_RUT", "  12345  ");
    const { COMPANY } = await cargar();
    expect(COMPANY.miturRut).toBe("12345");
  });
});

describe("whatsappLink", () => {
  test("sin número configurado devuelve null (la web oculta el botón)", async () => {
    vi.stubEnv("NEXT_PUBLIC_WHATSAPP_NUMBER", "");
    const { whatsappLink, COMPANY } = await cargar();
    expect(whatsappLink("Hola")).toBeNull();
    expect(COMPANY.hasWhatsapp).toBe(false);
  });

  test("limpia el número y codifica el mensaje", async () => {
    vi.stubEnv("NEXT_PUBLIC_WHATSAPP_NUMBER", "+1 (809) 555-0100");
    const { whatsappLink } = await cargar();
    expect(whatsappLink("Hola, quiero viajar")).toBe("https://wa.me/18095550100?text=Hola%2C%20quiero%20viajar");
  });
});
