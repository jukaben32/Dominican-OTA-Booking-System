// Validación de variables de entorno (secretos y configuración).
// Si falta algo, el servidor falla al usarlo con un mensaje claro (nunca con valores por defecto
// inseguros). El mensaje de error lista los NOMBRES de las variables, jamás sus valores.

import { z } from "zod";

const supabaseSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  // Llave de servicio de Supabase: salta la seguridad por filas. SOLO en el servidor.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
});

const serverSchema = supabaseSchema.extend({
  YCLOUD_API_KEY: z.string().min(10),
  YCLOUD_WEBHOOK_SECRET: z.string().min(10),
  // Número de WhatsApp Business emisor, formato E.164 (ej. +18095550100)
  WHATSAPP_FROM_NUMBER: z.string().regex(/^\+[1-9]\d{7,14}$/),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16),
  // Vercel Cron manda "Authorization: Bearer <CRON_SECRET>"
  CRON_SECRET: z.string().min(16),
});

// Reserva en línea sin agente
const onlineSchema = z.object({
  // Con este secreto se calcula el enlace privado de cada cliente: sin él nadie puede reconstruirlo
  ONLINE_LINK_SECRET: z.string().min(32),
  // Datos para transferir (banco, cuenta, titular). Texto libre; si falta, el cliente verá que un asesor lo contactará
  BANK_TRANSFER_INSTRUCTIONS: z.string().trim().max(800).optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;
export type OnlineEnv = z.infer<typeof onlineSchema>;
export type SupabaseEnv = z.infer<typeof supabaseSchema>;

// Valida con el esquema dado. El error lista solo NOMBRES de variables: nunca imprimimos los valores.
function parsear<T extends z.ZodType>(esquema: T, source: Record<string, string | undefined>): z.infer<T> {
  const resultado = esquema.safeParse(source);
  if (!resultado.success) {
    const problemas = [...new Set(resultado.error.issues.map((i) => String(i.path[0])))];
    throw new Error(`Configuración inválida o incompleta. Revisa estas variables: ${problemas.join(", ")}`);
  }
  return resultado.data;
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  return parsear(serverSchema, source);
}

// Solo lo necesario para hablar con Supabase (panel y acciones): no exige las variables de YCloud ni de pagos
export function parseSupabaseEnv(source: Record<string, string | undefined>): SupabaseEnv {
  return parsear(supabaseSchema, source);
}

export function parseOnlineEnv(source: Record<string, string | undefined>): OnlineEnv {
  return parsear(onlineSchema, source);
}

let onlineCache: OnlineEnv | undefined;
export function getOnlineEnv(): OnlineEnv {
  onlineCache ??= parseOnlineEnv(process.env);
  return onlineCache;
}

let cache: ServerEnv | undefined;
let supabaseCache: SupabaseEnv | undefined;

// Lee process.env una sola vez y lo valida
export function getServerEnv(): ServerEnv {
  cache ??= parseServerEnv(process.env);
  return cache;
}

export function getSupabaseEnv(): SupabaseEnv {
  supabaseCache ??= parseSupabaseEnv(process.env);
  return supabaseCache;
}
