import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { COMPANY } from "../company";
import { todayInSantoDomingo } from "../dates";
import { assembleBookingDocument } from "../pdf/assemble";
import { buildBookingPdf, type DocumentKind } from "../pdf/booking-document";
import type { BookingDetail } from "./booking-detail";
import { getDeparture, getTour, getVerifiedRequirement } from "./tours-repo";

export const PAID_STATUSES = new Set(["PAID", "TICKETED"]);

// Arma el PDF (cotización o voucher) de una reserva ya leída. Lo usan el panel y el enlace del cliente.
// El documento es para el CLIENTE: no contiene costos del proveedor ni la ganancia de la agencia.
export async function renderBookingPdf(
  db: SupabaseClient,
  reserva: BookingDetail,
  kind: DocumentKind,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const salida = reserva.departure_id ? await getDeparture(db, reserva.departure_id) : null;
  const tour = salida ? await getTour(db, salida.tour_id) : null;
  const requisito = tour ? await getVerifiedRequirement(db, tour.country_code) : null;

  const bytes = await buildBookingPdf(
    kind,
    assembleBookingDocument({
      agency: { name: COMPANY.brand, miturRut: COMPANY.miturRut, whatsapp: COMPANY.whatsappDisplay },
      generatedOn: todayInSantoDomingo(),
      booking: reserva,
      tour,
      departure: salida,
      requirement: requisito,
    }),
  );
  // El nombre del archivo sale del código de reserva ya validado por la base (letras, números y guion)
  const filename = `${kind === "VOUCHER" ? "voucher" : "cotizacion"}-${reserva.code.replace(/[^A-Za-z0-9-]/g, "")}.pdf`;
  return { bytes, filename };
}

export function pdfResponse(bytes: Uint8Array, filename: string): Response {
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
