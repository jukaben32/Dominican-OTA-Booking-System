// Descarga de la cotización o el voucher en PDF. SOLO personal autorizado (la sesión del agente aplica la seguridad por filas).
// El documento es para el CLIENTE: no contiene costos del proveedor ni la ganancia de la agencia.

import { getStaff } from "@/lib/auth";
import { logError } from "@/lib/logger";
import type { DocumentKind } from "@/lib/pdf/booking-document";
import { BOOKING_DETAIL_SELECT, bookingDetailSchema } from "@/lib/supabase/booking-detail";
import { createClient } from "@/lib/supabase/server";
import { PAID_STATUSES, pdfResponse, renderBookingPdf } from "@/lib/supabase/render-booking-pdf";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const usuario = await getStaff();
  if (!usuario) return Response.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: "Reserva no válida" }, { status: 400 });

  const tipo = new URL(request.url).searchParams.get("tipo");
  if (tipo !== "cotizacion" && tipo !== "voucher") return Response.json({ error: "Tipo de documento no válido" }, { status: 400 });
  const kind: DocumentKind = tipo === "voucher" ? "VOUCHER" : "QUOTE";

  try {
    const db = await createClient(); // con la sesión del agente
    const { data, error } = await db.from("bookings").select(BOOKING_DETAIL_SELECT).eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ error: "La reserva no existe" }, { status: 404 });

    const reserva = bookingDetailSchema.parse(data);
    // El voucher solo existe cuando está pagada al 100 %
    if (kind === "VOUCHER" && !PAID_STATUSES.has(reserva.status)) {
      return Response.json({ error: "El voucher solo está disponible cuando la reserva está pagada al 100 %" }, { status: 409 });
    }

    const { bytes, filename } = await renderBookingPdf(db, reserva, kind);
    return pdfResponse(bytes, filename);
  } catch (error) {
    logError("pdf.build_failed", error, { bookingId: id });
    return Response.json({ error: "No se pudo generar el documento" }, { status: 500 });
  }
}
