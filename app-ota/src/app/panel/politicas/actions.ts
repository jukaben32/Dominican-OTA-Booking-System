"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/components/action-form";
import { requireAdmin } from "@/lib/auth";
import { formToRaw } from "@/lib/form-data";
import { logError } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { parsePolicyForm } from "@/lib/tours/forms";

const UNIQUE_VIOLATION = "23505";

export async function createPolicyAction(_anterior: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const datos = parsePolicyForm(formToRaw(formData));
  if (!datos.ok) return { error: datos.error };

  const { data, error } = await createAdminClient()
    .from("cancellation_policies")
    .insert({ name: datos.value.name, rules: datos.value.rules })
    .select("id")
    .single();
  if (error?.code === UNIQUE_VIOLATION) return { error: "Ya existe una política con ese nombre" };
  if (error || !data) {
    logError("policies.create_failed", error ?? new Error("sin datos"));
    return { error: "No se pudo guardar la política. Inténtalo de nuevo" };
  }
  await createAdminClient().from("audit_log").insert({ actor_id: admin.id, action: "POLICY_CREATED", entity: "cancellation_policies", entity_id: data.id as string, details: {} });
  revalidatePath("/panel/politicas");
  redirect("/panel/politicas?guardado=1");
}

// Editar una política NO cambia las reservas ya vendidas (cada reserva guarda su propia copia)
export async function updatePolicyAction(_anterior: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = z.uuid().safeParse(formData.get("policyId"));
  if (!id.success) return { error: "La política no es válida" };
  const datos = parsePolicyForm(formToRaw(formData));
  if (!datos.ok) return { error: datos.error };

  const { error } = await createAdminClient()
    .from("cancellation_policies")
    .update({ name: datos.value.name, rules: datos.value.rules })
    .eq("id", id.data);
  if (error?.code === UNIQUE_VIOLATION) return { error: "Ya existe una política con ese nombre" };
  if (error) {
    logError("policies.update_failed", error, { policyId: id.data });
    return { error: "No se pudo guardar la política. Inténtalo de nuevo" };
  }
  await createAdminClient().from("audit_log").insert({ actor_id: admin.id, action: "POLICY_UPDATED", entity: "cancellation_policies", entity_id: id.data, details: {} });
  revalidatePath("/panel/politicas");
  redirect("/panel/politicas?guardado=1");
}
