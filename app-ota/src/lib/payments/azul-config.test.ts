import { describe, expect, test } from "vitest";
import { parseAzulEnv } from "./azul-config";

// Valores de PRUEBA inventados (no son credenciales reales)
const completo = {
  AZUL_MERCHANT_ID: "39038540035",
  AZUL_MERCHANT_NAME: "Mi Agencia",
  AZUL_AUTH_KEY: "clave-de-prueba",
  NEXT_PUBLIC_SITE_URL: "https://miagencia.test/",
};

describe("parseAzulEnv", () => {
  test("sin ninguna variable de Azul devuelve null (la tarjeta simplemente no se ofrece)", () => {
    expect(parseAzulEnv({})).toBeNull();
    expect(parseAzulEnv({ AZUL_MERCHANT_ID: "", AZUL_MERCHANT_NAME: "", AZUL_AUTH_KEY: "" })).toBeNull();
  });

  test("con todo lo necesario arma la configuración con valores por defecto seguros", () => {
    const s = parseAzulEnv(completo)!;
    expect(s.siteUrl).toBe("https://miagencia.test");
    expect(s.config).toMatchObject({ merchantType: "ECommerce", environment: "test", currencyCodes: { DOP: "$" } });
    expect(s.config.currencyCodes.USD).toBeUndefined();
  });

  test("dólares solo si se configuran", () => {
    expect(parseAzulEnv({ ...completo, AZUL_CURRENCY_CODE_USD: "USD" })!.config.currencyCodes.USD).toBe("USD");
  });

  test("configuración a medias falla y nombra las variables que faltan", () => {
    expect(() => parseAzulEnv({ AZUL_MERCHANT_ID: "39038540035" })).toThrow(/AZUL_AUTH_KEY/);
    expect(() => parseAzulEnv({ ...completo, NEXT_PUBLIC_SITE_URL: undefined })).toThrow(/NEXT_PUBLIC_SITE_URL/);
  });

  test("el mensaje de error nunca contiene los valores", () => {
    try {
      parseAzulEnv({ ...completo, AZUL_AUTH_KEY: "corta" });
    } catch (e) {
      expect(String(e)).not.toContain("corta");
      expect(String(e)).toContain("AZUL_AUTH_KEY");
      return;
    }
    throw new Error("debía fallar");
  });

  test("el código de dólares no puede ser igual al de pesos", () => {
    expect(() => parseAzulEnv({ ...completo, AZUL_CURRENCY_CODE_USD: "$" })).toThrow(/AZUL_CURRENCY_CODE_USD/);
  });

  test("en producción exige https para la dirección de retorno", () => {
    expect(() => parseAzulEnv({ ...completo, AZUL_ENVIRONMENT: "production", NEXT_PUBLIC_SITE_URL: "http://miagencia.test" })).toThrow(/https/);
    expect(parseAzulEnv({ ...completo, AZUL_ENVIRONMENT: "production" })!.config.environment).toBe("production");
  });
});
