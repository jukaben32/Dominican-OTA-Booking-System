// Webhook de YCloud: mensajes entrantes de clientes y estados de entrega de nuestros mensajes.
// SEGURIDAD: se verifica la firma "YCloud-Signature" ANTES de leer el contenido.

import { getServerEnv } from "@/lib/env";
import { readBodyLimited } from "@/lib/http";
import { logError } from "@/lib/logger";
import { verifyTimestampedSignature } from "@/lib/security";
import { handleYCloudEvent } from "@/lib/services/inbound-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseInboundStore } from "@/lib/supabase/stores/inbound-store";
import { parseYCloudEvent } from "@/lib/whatsapp/ycloud";

const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: Request): Promise<Response> {
  const env = getServerEnv();
  // Se lee con tope de BYTES: un cuerpo gigante se corta antes de agotar la memoria (y antes de verificar la firma)
  const rawBody = await readBodyLimited(request, MAX_BODY_BYTES);
  if (rawBody === null) {
    return Response.json({ error: "Cuerpo demasiado grande" }, { status: 413 });
  }

  const firmaValida = verifyTimestampedSignature({
    rawBody,
    header: request.headers.get("ycloud-signature"),
    secret: env.YCLOUD_WEBHOOK_SECRET,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!firmaValida) {
    return Response.json({ error: "Firma inválida" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  try {
    const result = await handleYCloudEvent(
      createSupabaseInboundStore(createAdminClient()),
      parseYCloudEvent(payload),
    );
    return Response.json({ result });
  } catch (error) {
    logError("webhook.ycloud.failed", error);
    // 500 = YCloud reintentará; el servicio libera la marca de "procesado" para que el reintento funcione
    return Response.json({ error: "Error interno" }, { status: 500 });
  }
}
