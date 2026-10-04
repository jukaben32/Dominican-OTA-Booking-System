"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/action-form";
import { requireAdmin } from "@/lib/auth";
import { formToRaw } from "@/lib/form-data";
import { logError } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseRequirementForm } from "@/lib/tours/forms";

// Guarda (crea o actualiza) los requisitos de entrada de un país.
// Regla: no se afirma nada sobre la visa sin la fuente oficial y la fecha de verificación (la base también lo exige).
export async function saveRequirementAction(_anterior: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const datos = parseRequirementForm(formToRaw(formData));
  if (!datos.ok) return { error: datos.error };

  const v = datos.value;
  const { error } = await createAdminClient()
    .from("destination_requirements")
    .upsert(
      {
        country_code: v.countryCode, country_name: v.countryName, passport_required: v.passportRequired,
        visa_status: v.visaStatus, vaccines: v.vaccines, notes: v.notes, source_url: v.sourceUrl,
        verified_at: v.verifiedAt, verified_by: v.visaStatus === "UNKNOWN" ? null : admin.id,
      },
      { onConflict: "country_code" },
    );
  if (error) {
    logError("requirements.save_failed", error, { country: v.countryCode });
    return { error: "No se pudo guardar. Revisa los datos e inténtalo de nuevo" };
  }
  await createAdminClient().from("audit_log").insert({
    actor_id: admin.id, action: "REQUIREMENT_SAVED", entity: "destination_requirements", entity_id: v.countryCode,
    details: { visa_status: v.visaStatus, verified_at: v.verifiedAt },
  });
  revalidatePath("/panel/requisitos");
  revalidatePath("/tours", "layout");
  redirect("/panel/requisitos?guardado=1");
}
