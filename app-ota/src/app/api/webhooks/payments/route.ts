// Webhook de pagos (contrato interno; el adaptador de Azul/CardNET lo llama firmado).
// SEGURIDAD: firma "x-payment-signature" con marca de tiempo, verificada ANTES de leer el contenido.

import { todayInSantoDomingo } from "@/lib/dates";
import { getServerEnv } from "@/lib/env";
import { readBodyLimited } from "@/lib/http";
import { logError } from "@/lib/logger";
import { verifyTimestampedSignature } from "@/lib/security";
import { gatewayEventSchema, processGatewayEvent } from "@/lib/services/gateway-service";
import { PaymentError } from "@/lib/services/payment-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseGatewayStore } from "@/lib/supabase/stores/gateway-store";
import { createSupabasePaymentStore } from "@/lib/supabase/stores/payment-store";

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request): Promise<Response> {
  const env = getServerEnv();
  // Se lee con tope de BYTES: un cuerpo gigante se corta antes de agotar la memoria (y antes de verificar la firma)
  const rawBody = await readBodyLimited(request, MAX_BODY_BYTES);
  if (rawBody === null) {
    return Response.json({ error: "Cuerpo demasiado grande" }, { status: 413 });
  }

  const firmaValida = verifyTimestampedSignature({
    rawBody,
    header: request.headers.get("x-payment-signature"),
    secret: env.PAYMENT_WEBHOOK_SECRET,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!firmaValida) {
    return Response.json({ error: "Firma inválida" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const evento = gatewayEventSchema.safeParse(json);
  if (!evento.success) {
    return Response.json({ error: "Evento inválido" }, { status: 400 });
  }

  try {
    const db = createAdminClient();
    const resultado = await processGatewayEvent({
      pagosStore: createSupabasePaymentStore(db),
      gatewayStore: createSupabaseGatewayStore(db),
      event: evento.data,
      today: todayInSantoDomingo(),
    });

    // 422 = el dinero llegó pero no se pudo aplicar: queda en la auditoría para conciliar a mano
    const rechazado = resultado.result.startsWith("REJECTED_");
    return Response.json({ result: resultado.result }, { status: rechazado ? 422 : 200 });
  } catch (error) {
    logError("webhook.payments.failed", error, { eventId: evento.data.eventId });
    const status = error instanceof PaymentError ? 422 : 500;
    return Response.json({ error: "No se pudo procesar el pago" }, { status });
  }
}
