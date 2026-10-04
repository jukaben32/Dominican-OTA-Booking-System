// Configuración de Azul desde variables de entorno.
// Si NO hay ninguna variable de Azul, el pago con tarjeta simplemente no se ofrece (no es un error).
// Si hay algunas pero faltan otras, SÍ es un error: mejor fallar claro que cobrar a medias.

import "server-only";
import { z } from "zod";
import type { AzulConfig } from "./azul";

const azulSchema = z.object({
  AZUL_MERCHANT_ID: z.string().trim().min(3).max(40),
  AZUL_MERCHANT_NAME: z.string().trim().min(2).max(25),
  AZUL_AUTH_KEY: z.string().min(8).max(200),
  AZUL_MERCHANT_TYPE: z.string().trim().min(1).max(30).default("ECommerce"),
  AZUL_ENVIRONMENT: z.enum(["test", "production"]).default("test"),
  AZUL_CURRENCY_CODE_DOP: z.string().trim().min(1).max(5).default("$"),
  // Dólares: solo si Azul los habilitó para tu comercio. Sin esto, las reservas en USD no ofrecen tarjeta.
  AZUL_CURRENCY_CODE_USD: z.string().trim().min(1).max(5).optional(),
  // Dirección pública de la web (a donde Azul devuelve al cliente). En producción debe ser https.
  NEXT_PUBLIC_SITE_URL: z.url(),
});

export interface AzulSetup {
  config: AzulConfig;
  siteUrl: string; // sin "/" al final
}

const NOMBRES = ["AZUL_MERCHANT_ID", "AZUL_MERCHANT_NAME", "AZUL_AUTH_KEY"] as const;

export function parseAzulEnv(source: Record<string, string | undefined>): AzulSetup | null {
  // Texto vacío = variable sin definir (así queda un .env.example copiado sin llenar)
  const limpio = Object.fromEntries(Object.entries(source).map(([k, v]) => [k, v === "" ? undefined : v]));
  if (NOMBRES.every((n) => limpio[n] === undefined)) return null;

  const r = azulSchema.safeParse(limpio);
  if (!r.success) {
    const problemas = [...new Set(r.error.issues.map((i) => String(i.path[0])))];
    throw new Error(`Configuración de Azul incompleta o inválida. Revisa estas variables: ${problemas.join(", ")}`);
  }
  const e = r.data;
  const siteUrl = e.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");
  if (e.AZUL_ENVIRONMENT === "production" && !siteUrl.startsWith("https://")) {
    throw new Error("Configuración de Azul inválida. Revisa estas variables: NEXT_PUBLIC_SITE_URL (en producción debe ser https)");
  }
  if (e.AZUL_CURRENCY_CODE_USD && e.AZUL_CURRENCY_CODE_USD === e.AZUL_CURRENCY_CODE_DOP) {
    // Con el mismo código, Azul cobraría pesos como si fueran dólares sin que nada lo notara
    throw new Error("Configuración de Azul inválida. Revisa estas variables: AZUL_CURRENCY_CODE_USD (no puede ser igual al de pesos)");
  }
  return {
    siteUrl,
    config: {
      merchantId: e.AZUL_MERCHANT_ID,
      merchantName: e.AZUL_MERCHANT_NAME,
      merchantType: e.AZUL_MERCHANT_TYPE,
      authKey: e.AZUL_AUTH_KEY,
      environment: e.AZUL_ENVIRONMENT,
      currencyCodes: {
        DOP: e.AZUL_CURRENCY_CODE_DOP,
        ...(e.AZUL_CURRENCY_CODE_USD ? { USD: e.AZUL_CURRENCY_CODE_USD } : {}),
      },
    },
  };
}

let cache: { valor: AzulSetup | null } | undefined;

// Lee process.env una sola vez. null = Azul no está configurado.
export function getAzulSetup(): AzulSetup | null {
  cache ??= { valor: parseAzulEnv(process.env) };
  return cache.valor;
}
