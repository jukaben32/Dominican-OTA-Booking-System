import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

export type StaffRole = "ADMIN" | "AGENT";

export interface StaffUser {
  id: string;
  email: string | undefined;
  role: StaffRole;
  fullName: string | null;
}

// Devuelve al usuario si es personal de la agencia (ADMIN o AGENT); si no, null. NO redirige (sirve para rutas API).
export async function getStaff(): Promise<StaffUser | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;

  const { data: perfil } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!perfil || (perfil.role !== "ADMIN" && perfil.role !== "AGENT")) return null;

  return {
    id: data.user.id,
    email: data.user.email,
    role: perfil.role as StaffRole,
    fullName: perfil.full_name,
  };
}

// Exige que quien llama sea personal de la agencia (ADMIN o AGENT).
// Se usa al INICIO de cada página y acción del panel: la seguridad no depende solo del proxy.
export async function requireStaff(): Promise<StaffUser> {
  const usuario = await getStaff();
  if (usuario) return usuario;

  // Si hay sesión pero no es del personal, la cerramos para que no quede a medias
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    await supabase.auth.signOut();
    redirect("/login?error=sin-acceso");
  }
  redirect("/login");
}

// Exige ADMINISTRADOR (catálogo de tours, costos y márgenes, políticas y requisitos).
// Un agente que intente entrar vuelve al resumen.
export async function requireAdmin(): Promise<StaffUser> {
  const usuario = await requireStaff();
  if (usuario.role !== "ADMIN") redirect("/panel?aviso=solo-admin");
  return usuario;
}
