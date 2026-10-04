// A esta dirección vuelve el NAVEGADOR del cliente desde la Página de Pago de Azul (GET con el resultado en la URL).
// Es pública a propósito: la seguridad no viene de la sesión sino de verificar la firma de Azul (ver azul-service.ts).
// Nunca se confía en lo que diga la URL: se recalcula la firma con la llave secreta, que no viaja por el navegador.

import { NextRequest, NextResponse } from "next/server";
import { todayInSantoDomingo } from "@/lib/dates";
import { getOnlineEnv } from "@/lib/env";
import { logError } from "@/lib/logger";
import { attemptKey, clientIp, deriveAccessToken } from "@/lib/online/access-token";
import { getAzulSetup } from "@/lib/payments/azul-config";
import { handleAzulReturn } from "@/lib/services/azul-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { takeAttempt } from "@/lib/supabase/online-repo";
import { createSupabaseAzulStore } from "@/lib/supabase/stores/azul-store";
import { createSupabaseGatewayStore } from "@/lib/supabase/stores/gateway-store";
import { createSupabasePaymentStore } from "@/lib/supabase/stores/payment-store";

const ORDER_FORMAT = /^[0-9a-f]{15}$/; // el formato de nuestras órdenes: lo demás ni toca la base
const MAX_RETURNS_PER_HOUR = 60; // por IP

type Estado = "aprobado" | "declinado" | "cancelado" | "revision" | "error";

// A dónde mandar al cliente: a su reserva en línea (si la tiene) o a una página de aviso
async function destino(origin: string, bookingId: string | null, estado: Estado): Promise<URL> {
  if (bookingId) {
    const { data } = await createAdminClient().from("bookings").select("source, form_token").eq("id", bookingId).maybeSingle();
    if (data?.source === "ONLINE" && data.form_token) {
      const { token } = deriveAccessToken(String(data.form_token), getOnlineEnv().ONLINE_LINK_SECRET);
      const url = new URL(`/mi-reserva/${token}`, origin);
      url.searchParams.set("pago", estado);
      return url;
    }
  }
  const url = new URL("/pago-recibido", origin);
  url.searchParams.set("estado", estado);
  return url;
}

export async function GET(request: NextRequest): Promise<Response> {
  // Dirección pública configurada: no se usa la que venga en la petición (podría ser falsificada)
  const setup = getAzulSetup();
  if (!setup) return NextResponse.json({ error: "No disponible" }, { status: 404 });
  const origin = setup.siteUrl;
  const p = request.nextUrl.searchParams;
  const db = createAdminClient();

  try {
    // El cliente tocó "Cancelar" en Azul: no trae firma, así que NO cambia ningún estado. Va a una página de aviso
    // (nunca a su reserva: la orden por sí sola no debe dar acceso al enlace privado)
    if (p.get("cancelado") === "1") return NextResponse.redirect(await destino(origin, null, "cancelado"));

    const orderNumber = p.get("OrderNumber");
    const authHash = p.get("AuthHash");
    if (!orderNumber || !authHash || !ORDER_FORMAT.test(orderNumber)) return NextResponse.redirect(await destino(origin, null, "error"));

    // Ruta pública: se limita por IP para que nadie la use para llenar la base o los registros
    const ip = clientIp(request.headers);
    if (ip && !(await takeAttempt(db, attemptKey("azul-retorno", ip), MAX_RETURNS_PER_HOUR, 60))) {
      return NextResponse.redirect(await destino(origin, null, "error"));
    }

    const resultado = await handleAzulReturn({
      store: createSupabaseAzulStore(db),
      pagosStore: createSupabasePaymentStore(db),
      gatewayStore: createSupabaseGatewayStore(db),
      config: setup.config,
      today: todayInSantoDomingo(),
      params: {
        orderNumber,
        amount: p.get("Amount") ?? "",
        authorizationCode: p.get("AuthorizationCode") ?? "",
        dateTime: p.get("DateTime") ?? "",
        responseCode: p.get("ResponseCode") ?? "",
        isoCode: p.get("IsoCode") ?? "",
        responseMessage: p.get("ResponseMessage") ?? "",
        errorDescription: p.get("ErrorDescription") ?? "",
        rrn: p.get("RRN") ?? "",
        azulOrderId: p.get("AzulOrderId") ?? "",
        authHash,
      },
    });

    if (resultado.outcome === "invalid") {
      logError("azul.return_invalid", new Error(resultado.reason));
      return NextResponse.redirect(await destino(origin, null, "error"));
    }
    const estado: Estado = resultado.outcome === "approved" ? "aprobado" : resultado.outcome === "declined" ? "declinado" : "revision";
    return NextResponse.redirect(await destino(origin, resultado.bookingId, estado));
  } catch (error) {
    // Error técnico: el cliente ve un aviso neutro; el detalle queda en el registro
    logError("azul.return_failed", error);
    return NextResponse.redirect(await destino(origin, null, "error").catch(() => new URL("/", origin)));
  }
}
