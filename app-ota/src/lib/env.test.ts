import { describe, expect, test } from "vitest";
import { parseServerEnv, parseOnlineEnv, parseSupabaseEnv } from "./env";

// Valores de PRUEBA inventados (no son credenciales reales)
const valido = {
  NEXT_PUBLIC_SUPABASE_URL: "https://proyecto-prueba.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-de-prueba-0123456789",
  SUPABASE_SERVICE_ROLE_KEY: "service-key-de-prueba-0123456789",
  YCLOUD_API_KEY: "ycloud-key-prueba",
  YCLOUD_WEBHOOK_SECRET: "ycloud-secreto-prueba",
  WHATSAPP_FROM_NUMBER: "+18095550100",
  PAYMENT_WEBHOOK_SECRET: "pagos-secreto-de-prueba",
  CRON_SECRET: "cron-secreto-de-prueba",
};

describe("parseServerEnv", () => {
  test("acepta una configuración completa", () => {
    expect(parseServerEnv(valido).WHATSAPP_FROM_NUMBER).toBe("+18095550100");
  });

  test("falla si falta una variable y dice cuál", () => {
    const incompleto: Record<string, string | undefined> = { ...valido, CRON_SECRET: undefined };
    expect(() => parseServerEnv(incompleto)).toThrow(/CRON_SECRET/);
  });

  test("falla si un secreto es demasiado corto", () => {
    expect(() => parseServerEnv({ ...valido, CRON_SECRET: "corto" })).toThrow(/CRON_SECRET/);
  });

  test("falla si el número de WhatsApp no está en formato E.164", () => {
    expect(() => parseServerEnv({ ...valido, WHATSAPP_FROM_NUMBER: "809-555-0100" })).toThrow(
      /WHATSAPP_FROM_NUMBER/,
    );
  });

  test("el mensaje de error NUNCA incluye el valor de los secretos", () => {
    try {
      parseServerEnv({ ...valido, CRON_SECRET: "x", YCLOUD_API_KEY: "secreto-visible" });
    } catch (error) {
      const mensaje = String(error);
      expect(mensaje).not.toContain("secreto-visible");
      return;
    }
    throw new Error("debía fallar");
  });
});

describe("parseSupabaseEnv", () => {
  test("solo exige las 3 variables de Supabase (el panel no necesita las de YCloud)", () => {
    const soloSupabase = {
      NEXT_PUBLIC_SUPABASE_URL: valido.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: valido.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: valido.SUPABASE_SERVICE_ROLE_KEY,
    };
    expect(parseSupabaseEnv(soloSupabase).SUPABASE_SERVICE_ROLE_KEY).toBe(valido.SUPABASE_SERVICE_ROLE_KEY);
  });

  test("falla y nombra la variable si falta la llave de servicio", () => {
    expect(() =>
      parseSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: valido.NEXT_PUBLIC_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: valido.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      }),
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("parseOnlineEnv", () => {
  test("exige un secreto de al menos 32 caracteres y nombra la variable si falta", () => {
    expect(() => parseOnlineEnv({})).toThrow(/ONLINE_LINK_SECRET/);
    expect(() => parseOnlineEnv({ ONLINE_LINK_SECRET: "corto" })).toThrow(/ONLINE_LINK_SECRET/);
    expect(parseOnlineEnv({ ONLINE_LINK_SECRET: "x".repeat(32) }).BANK_TRANSFER_INSTRUCTIONS).toBeUndefined();
  });

  test("las instrucciones bancarias son opcionales, se recortan y tienen tope de largo", () => {
    expect(parseOnlineEnv({ ONLINE_LINK_SECRET: "x".repeat(32), BANK_TRANSFER_INSTRUCTIONS: "  Banco X  " }).BANK_TRANSFER_INSTRUCTIONS).toBe("Banco X");
    expect(() => parseOnlineEnv({ ONLINE_LINK_SECRET: "x".repeat(32), BANK_TRANSFER_INSTRUCTIONS: "a".repeat(801) })).toThrow(/BANK_TRANSFER_INSTRUCTIONS/);
  });
});
