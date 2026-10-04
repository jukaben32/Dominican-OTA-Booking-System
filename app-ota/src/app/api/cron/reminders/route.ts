// Tarea diaria de cobros (Vercel Cron, ver vercel.json): actualiza cuotas vencidas
// y envía los recordatorios de WhatsApp de hoy.
// SEGURIDAD: Vercel manda "Authorization: Bearer <CRON_SECRET>"; sin eso, 401.

import { todayInSantoDomingo } from "@/lib/dates";
import { getServerEnv } from "@/lib/env";
import { logError } from "@/lib/logger";
import { verifyBearer } from "@/lib/security";
import { runReminders } from "@/lib/services/reminder-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanupOldProofs } from "@/lib/supabase/proof-cleanup";
import { createSupabaseReminderStore } from "@/lib/supabase/stores/reminder-store";
import { createYCloudSender } from "@/lib/whatsapp/ycloud";

export async function GET(request: Request): Promise<Response> {
  const env = getServerEnv();

  if (!verifyBearer(request.headers.get("authorization"), env.CRON_SECRET)) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  // Primero se liberan los cupos de reservas en línea que nadie pagó a tiempo; si falla, los recordatorios siguen
  let vencidas = 0;
  try {
    const { data, error } = await createAdminClient().rpc("expire_online_holds");
    if (error) throw error;
    vencidas = typeof data === "number" ? data : 0;
  } catch (error) {
    logError("cron.expire_online_holds.failed", error);
  }

  // Después se borran los comprobantes de pagos rechazados o de reservas vencidas con mucha antigüedad
  let comprobantesBorrados = 0;
  try {
    comprobantesBorrados = (await cleanupOldProofs(createAdminClient())).removed;
  } catch (error) {
    logError("cron.cleanup_proofs.failed", error);
  }

  try {
    const resumen = await runReminders({
      store: createSupabaseReminderStore(createAdminClient()),
      sender: createYCloudSender({ apiKey: env.YCLOUD_API_KEY, from: env.WHATSAPP_FROM_NUMBER }),
      today: todayInSantoDomingo(),
    });

    // Los errores por plan se registran (sin datos personales: solo el id del plan)
    for (const e of resumen.errors) logError("cron.reminders.plan_failed", new Error(e.message), { planId: e.planId });

    return Response.json({ ...resumen, onlineHoldsExpired: vencidas, proofsRemoved: comprobantesBorrados });
  } catch (error) {
    logError("cron.reminders.failed", error);
    return Response.json({ error: "Error interno" }, { status: 500 });
  }
}
