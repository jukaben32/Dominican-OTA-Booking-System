// Descarga de la cotización o el voucher por el cliente, con su enlace privado (sin cuenta).
// El voucher solo existe con la reserva pagada al 100 %. Se limita por IP porque generar un PDF cuesta CPU.

import { headers } from "next/headers";
import { logError } from "@/lib/logger";
import { attemptKey, clientIp, hashAccessToken, isValidTokenFormat } from "@/lib/online/access-token";
import type { DocumentKind } from "@/lib/pdf/booking-document";
import { createAdminClient } from "@/lib/supabase/admin";
import { BOOKING_DETAIL_SELECT, bookingDetailSchema } from "@/lib/supabase/booking-detail";
import { takeAttempt } from "@/lib/supabase/online-repo";
import { PAID_STATUSES, pdfResponse, renderBookingPdf } from "@/lib/supabase/render-booking-pdf";

const MAX_PER_HOUR = 30;

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  if (!isValidTokenFormat(token)) return Response.json({ error: "No encontrada" }, { status: 404 });

  const tipo = new URL(request.url).searchParams.get("tipo");
  if (tipo !== "cotizacion" && tipo !== "voucher") return Response.json({ error: "Tipo de documento no válido" }, { status: 400 });
  const kind: DocumentKind = tipo === "voucher" ? "VOUCHER" : "QUOTE";

  try {
    const db = createAdminClient();
    const ip = clientIp(await headers());
    if (ip && !(await takeAttempt(db, attemptKey("documento-ip", ip), MAX_PER_HOUR, 60))) {
      return Response.json({ error: "Demasiados intentos. Espera un rato" }, { status: 429 });
    }

    // Misma consulta que el panel (sin costos ni comisión), pero solo de la reserva dueña de este enlace
    const { data, error } = await db
      .from("bookings")
      .select(BOOKING_DETAIL_SELECT)
      .eq("access_token_hash", hashAccessToken(token))
      .maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ error: "No encontrada" }, { status: 404 });

    const reserva = bookingDetailSchema.parse(data);
    if (kind === "VOUCHER" && !PAID_STATUSES.has(reserva.status)) {
      return Response.json({ error: "El voucher solo está disponible cuando la reserva está pagada al 100 %" }, { status: 409 });
    }
    const { bytes, filename } = await renderBookingPdf(db, reserva, kind);
    return pdfResponse(bytes, filename);
  } catch (error) {
    logError("pdf.customer_build_failed", error);
    return Response.json({ error: "No se pudo generar el documento" }, { status: 500 });
  }
}
