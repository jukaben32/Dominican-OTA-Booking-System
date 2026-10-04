import { describe, expect, test } from "vitest";
import {
  AZUL_URLS,
  buildAzulPaymentForm,
  computeRequestAuthHash,
  computeResponseAuthHash,
  isApproved,
  toAzulAmount,
  verifyAzulResponse,
  type AzulConfig,
  type AzulResultParams,
} from "./azul";

// Valores de PRUEBA inventados (no son credenciales reales)
const KEY = "clave-de-prueba";
const config: AzulConfig = {
  merchantId: "39038540035",
  merchantName: "Mi Agencia",
  merchantType: "ECommerce",
  authKey: KEY,
  environment: "test",
  currencyCodes: { DOP: "$" },
};

// Hashes calculados UNA vez con el procedimiento del manual (HMAC-SHA512 sobre UTF-16LE): si alguien cambia el
// orden de los campos o la codificación, estas pruebas fallan (no se puede probar contra Azul sin credenciales)
const HASH_PETICION = "7a26719f7eaf8b9f0de0f0408424205b0840ce4a5825ae9c79cbb238e7dec3a7d408d61ba3aec8343f41fd71b1fb588f22ac5ab414ba074c1d9a0d6dfaae872e";
const HASH_RESPUESTA = "d5591ef10ad3b4f8e9cc72d02dfa8dc83eb2e8d5fe92b90d7b7942c1fe464a759508279dc495749f559394e454469d48b4065652fce41ee87474306bb2d2d6ce";

describe("toAzulAmount", () => {
  test("los centavos se envían tal cual, sin coma ni punto", () => {
    expect(toAzulAmount(150000)).toBe("150000");
    expect(toAzulAmount(0)).toBe("0");
  });
  test("rechaza decimales y negativos", () => {
    expect(() => toAzulAmount(10.5)).toThrow();
    expect(() => toAzulAmount(-1)).toThrow();
  });
});

describe("computeRequestAuthHash", () => {
  const entrada = {
    merchantId: "39038540035", merchantName: "Mi Agencia", merchantType: "ECommerce", currencyCode: "$",
    orderNumber: "ABC123DEF456789", amount: "150000", itbis: "0",
    approvedUrl: "https://x.test/r", declinedUrl: "https://x.test/r", cancelUrl: "https://x.test/r?c=1", authKey: KEY,
  };
  test("coincide con el valor de referencia", () => {
    expect(computeRequestAuthHash(entrada)).toBe(HASH_PETICION);
  });
  test("cambia si cambia cualquier dato firmado (monto, orden o URL)", () => {
    expect(computeRequestAuthHash({ ...entrada, amount: "150001" })).not.toBe(HASH_PETICION);
    expect(computeRequestAuthHash({ ...entrada, orderNumber: "ABC123DEF456780" })).not.toBe(HASH_PETICION);
    expect(computeRequestAuthHash({ ...entrada, approvedUrl: "https://otro.test/r" })).not.toBe(HASH_PETICION);
  });
});

describe("respuesta de Azul", () => {
  const base = {
    orderNumber: "ABC123DEF456789", amount: "150000", authorizationCode: "A1B2C3", dateTime: "20261004120000",
    responseCode: "ISO8583", isoCode: "00", responseMessage: "APROBADA", errorDescription: "", rrn: "123456789012",
  };
  const respuesta: AzulResultParams = { ...base, azulOrderId: "999", authHash: HASH_RESPUESTA };

  test("la firma de referencia coincide", () => {
    expect(computeResponseAuthHash(base, KEY)).toBe(HASH_RESPUESTA);
    expect(verifyAzulResponse(respuesta, KEY)).toBe(true);
  });
  test("acepta la firma en mayúsculas", () => {
    expect(verifyAzulResponse({ ...respuesta, authHash: HASH_RESPUESTA.toUpperCase() }, KEY)).toBe(true);
  });
  test("rechaza si alguien cambia el monto, la aprobación o la firma, o si falta la firma", () => {
    expect(verifyAzulResponse({ ...respuesta, amount: "100" }, KEY)).toBe(false);
    expect(verifyAzulResponse({ ...respuesta, isoCode: "05" }, KEY)).toBe(false);
    expect(verifyAzulResponse({ ...respuesta, authHash: "0".repeat(128) }, KEY)).toBe(false);
    expect(verifyAzulResponse({ ...respuesta, authHash: "" }, KEY)).toBe(false);
  });
  test("rechaza una firma hecha con otra llave", () => {
    expect(verifyAzulResponse(respuesta, "otra-llave")).toBe(false);
  });
  test("solo el código ISO 00 es aprobado", () => {
    expect(isApproved({ isoCode: "00" })).toBe(true);
    expect(isApproved({ isoCode: "05" })).toBe(false);
    expect(isApproved({ isoCode: "" })).toBe(false);
  });
});

describe("buildAzulPaymentForm", () => {
  const entrada = {
    config, orderNumber: "ABC123DEF456789", amountCents: 150000, itbisCents: 0, currency: "DOP" as const,
    returnUrl: "https://x.test/r", cancelUrl: "https://x.test/r?c=1",
  };

  test("arma todos los campos y la firma de referencia", () => {
    const f = buildAzulPaymentForm(entrada)!;
    expect(f.actionUrl).toBe(AZUL_URLS.test);
    expect(f.fields).toMatchObject({
      MerchantId: "39038540035", CurrencyCode: "$", OrderNumber: "ABC123DEF456789", Amount: "150000", ITBIS: "0",
      ApprovedUrl: "https://x.test/r", DeclinedUrl: "https://x.test/r", CancelUrl: "https://x.test/r?c=1",
      UseCustomField1: "0", UseCustomField2: "0", AuthHash: HASH_PETICION,
    });
  });
  test("la llave secreta NUNCA aparece entre los campos que viajan por el navegador", () => {
    const f = buildAzulPaymentForm(entrada)!;
    expect(JSON.stringify(f)).not.toContain(KEY);
  });
  test("usa la dirección de producción cuando se pide", () => {
    expect(buildAzulPaymentForm({ ...entrada, config: { ...config, environment: "production" } })!.actionUrl).toBe(AZUL_URLS.production);
  });
  test("sin código de moneda configurado (dólares) no se puede cobrar con tarjeta", () => {
    expect(buildAzulPaymentForm({ ...entrada, currency: "USD" })).toBeNull();
    expect(buildAzulPaymentForm({ ...entrada, currency: "USD", config: { ...config, currencyCodes: { USD: "USD" } } })).not.toBeNull();
  });
});
