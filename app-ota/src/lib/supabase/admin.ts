import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "../env";

// Cliente con la llave de servicio: SALTA la seguridad por filas (RLS).
// Solo se usa en webhooks, cron y acciones del servidor que ya verificaron permisos.
// "server-only" hace fallar la compilación si alguien lo importa desde un componente del navegador.
export function createAdminClient(): SupabaseClient {
  const env = getSupabaseEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
