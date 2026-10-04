"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { logError } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ refundId: z.uuid(), note: z.string().trim().max(300) });
const VOLVER = "/panel/reembolsos";

// El administrador marca que ya transfirió el dinero. La condición status = PENDING evita marcar dos veces.
export async function markRefundDoneAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const datos = schema.safeParse({ refundId: formData.get("refundId"), note: formData.get("note") ?? "" });
  if (!datos.success) redirect(`${VOLVER}?error=datos`);

  const db = createAdminClient();
  const { data, error } = await db
    .from("refunds")
    .update({ status: "DONE", done_at: new Date().toISOString(), done_by: admin.id, note: datos.data.note || null })
    .eq("id", datos.data.refundId)
    .eq("status", "PENDING")
    .select("id, booking_id");
  if (error) {
    logError("refunds.mark_done_failed", error, { refundId: datos.data.refundId });
    redirect(`${VOLVER}?error=interno`);
  }
  if (!data || data.length === 0) redirect(`${VOLVER}?error=yahecho`);

  const { error: errorAuditoria } = await db.from("audit_log").insert({
    actor_id: admin.id, action: "REFUND_DONE", entity: "refunds", entity_id: datos.data.refundId, details: { bookingId: data[0].booking_id },
  });
  if (errorAuditoria) logError("refunds.audit_failed", errorAuditoria, { refundId: datos.data.refundId });

  revalidatePath(VOLVER);
  redirect(`${VOLVER}?ok=1`);
}
