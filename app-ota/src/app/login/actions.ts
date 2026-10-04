"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { logError } from "@/lib/logger";
import { attemptKey, clientIp } from "@/lib/online/access-token";
import { createAdminClient } from "@/lib/supabase/admin";
import { takeAttempt } from "@/lib/supabase/online-repo";
import { createClient } from "@/lib/supabase/server";

const WINDOW_MINUTES = 15;
const MAX_BY_IP = 20; // intentos por IP en la ventana (una oficina comparte IP)
const MAX_BY_IP_AND_EMAIL = 6; // intentos para un mismo correo desde una misma IP

// true = se puede intentar. Si el contador falla se deja pasar: Supabase tiene además su propio límite de inicio de sesión.
async function puedeIntentar(email: string): Promise<boolean> {
  try {
    const ip = clientIp(await headers());
    if (!ip) return true;
    const db = createAdminClient();
    // Por IP y correo juntos: un atacante no puede bloquear a un administrador desde otra IP
    const porCorreo = await takeAttempt(db, attemptKey("login-ip-correo", `${ip}|${email.toLowerCase()}`), MAX_BY_IP_AND_EMAIL, WINDOW_MINUTES);
    const porIp = await takeAttempt(db, attemptKey("login-ip", ip), MAX_BY_IP, WINDOW_MINUTES);
    return porCorreo && porIp;
  } catch (error) {
    logError("login.rate_limit_failed", error);
    return true;
  }
}

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

export async function signIn(formData: FormData): Promise<void> {
  const datos = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!datos.success) redirect("/login?error=credenciales");

  if (!(await puedeIntentar(datos.data.email))) redirect("/login?error=intentos");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(datos.data);

  // Mensaje genérico: no revelamos si el correo existe o no
  if (error) redirect("/login?error=credenciales");
  redirect("/panel");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
