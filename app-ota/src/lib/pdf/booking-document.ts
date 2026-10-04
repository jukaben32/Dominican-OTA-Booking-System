// Cotización y voucher en PDF. Para el CLIENTE: nunca incluyen el costo del proveedor ni la ganancia de la agencia,
// solo el precio total y el ITBIS que contiene.

import { formatMoney, type Cents, type Currency } from "../money";
import { PdfBuilder, COLORES } from "./builder";
import { describePolicy, type CancellationRule } from "../tours/cancellation";
import type { ItineraryDay } from "../tours/itinerary";

export type DocumentKind = "QUOTE" | "VOUCHER";

export interface RequirementDoc {
  countryName: string;
  passportRequired: boolean;
  visaStatus: "UNKNOWN" | "NOT_REQUIRED" | "REQUIRED" | "ON_ARRIVAL" | "E_VISA";
  vaccines: string | null;
  notes: string | null;
  sourceUrl: string | null;
  verifiedAt: string | null; // AAAA-MM-DD
}

export interface BookingDocumentData {
  agency: { name: string; miturRut: string | null; whatsapp: string | null };
  generatedOn: string; // AAAA-MM-DD
  booking: {
    code: string;
    status: string;
    currency: Currency;
    totalCents: Cents;
    itbisCents: Cents;
    paidCents: Cents;
    pnr: string | null;
  };
  customer: { fullName: string; phone: string };
  passengers: string[];
  tour: {
    title: string;
    destination: string;
    durationDays: number;
    departsOn: string | null;
    returnsOn: string | null;
    saleClosesOn: string | null;
    includes: string[];
    excludes: string[];
    itinerary: ItineraryDay[];
  } | null;
  segments: { airline: string; origin: string; dest: string; departsAt: string }[];
  plan: { frequency: string; finalDueDate: string; rows: { label: string; dueDate: string; amountCents: Cents; paidCents: Cents }[] } | null;
  cancellationRules: CancellationRule[] | null;
  requirements: RequirementDoc | null;
}

const fecha = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

const VISA: Record<RequirementDoc["visaStatus"], string> = {
  UNKNOWN: "Por confirmar",
  NOT_REQUIRED: "No se requiere visa",
  REQUIRED: "Se requiere visa",
  ON_ARRIVAL: "Visa a la llegada",
  E_VISA: "Visa electrónica",
};
const FRECUENCIA: Record<string, string> = { WEEKLY: "semanal", BIWEEKLY: "quincenal", MONTHLY: "mensual" };

export async function buildBookingPdf(kind: DocumentKind, d: BookingDocumentData): Promise<Uint8Array> {
  const esVoucher = kind === "VOUCHER";
  const dinero = (c: Cents) => formatMoney(c, d.booking.currency);
  const contacto = d.agency.whatsapp ? `WhatsApp ${d.agency.whatsapp}` : "";
  const licencia = d.agency.miturRut ? `Licencia MITUR RUT ${d.agency.miturRut}` : "Licencia MITUR: en trámite";

  const pdf = await PdfBuilder.create({
    title: `${esVoucher ? "Voucher" : "Cotización"} ${d.booking.code}`,
    author: d.agency.name,
    footer: `${d.agency.name} · ${licencia}${contacto ? ` · ${contacto}` : ""} · Generado el ${fecha(d.generatedOn)}`,
  });

  pdf.masthead(d.agency.name, `${esVoucher ? "Voucher de viaje" : "Cotización de viaje"} · ${licencia}`);

  pdf.keyValues([
    ["Reserva", d.booking.code],
    ["Cliente", d.customer.fullName],
    ["Teléfono", d.customer.phone],
    ["Fecha del documento", fecha(d.generatedOn)],
  ]);
  pdf.space(8);

  if (esVoucher) {
    pdf.callout(
      "Reserva confirmada",
      `Pago completo recibido (${dinero(d.booking.paidCents)}).${d.booking.pnr ? ` Localizador: ${d.booking.pnr}.` : ""} Presenta este voucher y tu documento de identidad en cada servicio.`,
      COLORES.ok,
    );
  } else {
    const hasta = d.tour?.saleClosesOn ? ` La venta de esta salida cierra el ${fecha(d.tour.saleClosesOn)}.` : "";
    pdf.callout(
      "Cotización",
      `El precio y los cupos están sujetos a disponibilidad hasta confirmar el pago.${hasta}`,
    );
  }

  // ---- Viaje ----
  pdf.heading("Tu viaje");
  const filasViaje: [string, string][] = [];
  if (d.tour) {
    filasViaje.push(["Tour", d.tour.title], ["Destino", d.tour.destination], ["Duración", `${d.tour.durationDays} días`]);
    if (d.tour.departsOn) filasViaje.push(["Salida", fecha(d.tour.departsOn)]);
    if (d.tour.returnsOn) filasViaje.push(["Regreso", fecha(d.tour.returnsOn)]);
  }
  filasViaje.push(["Pasajeros", d.passengers.join(", ")]);
  pdf.keyValues(filasViaje);

  if (d.segments.length > 0) {
    pdf.space(4);
    pdf.text("Vuelos", { bold: true, color: COLORES.suave, size: 9.5 });
    pdf.bullets(d.segments.map((s) => `${s.airline}: ${s.origin} → ${s.dest} · ${s.departsAt}`));
  }

  // ---- Itinerario ----
  if (d.tour && d.tour.itinerary.length > 0) {
    pdf.heading("Itinerario");
    for (const dia of d.tour.itinerary) {
      pdf.text(`Día ${dia.day} · ${dia.title}`, { bold: true, size: 10.5 });
      if (dia.description) pdf.text(dia.description, { indent: 12, color: COLORES.suave });
      pdf.space(4);
    }
  }

  if (d.tour && d.tour.includes.length > 0) {
    pdf.heading("Incluye");
    pdf.bullets(d.tour.includes);
  }
  if (d.tour && d.tour.excludes.length > 0) {
    pdf.heading("No incluye");
    pdf.bullets(d.tour.excludes);
  }

  // ---- Precio y pago ----
  pdf.heading("Precio y pago");
  const saldo = d.booking.totalCents - d.booking.paidCents;
  pdf.table({
    headers: ["Concepto", "Monto"],
    widths: [372, 132],
    rightAligned: [1],
    rows: [
      [`Precio total (${d.passengers.length} ${d.passengers.length === 1 ? "pasajero" : "pasajeros"})`, dinero(d.booking.totalCents)],
      ["ITBIS incluido en el precio", dinero(d.booking.itbisCents)],
      ["Pagado a la fecha", dinero(d.booking.paidCents)],
      ["Saldo pendiente", dinero(Math.max(0, saldo))],
    ],
  });

  if (d.plan) {
    pdf.text(
      `Plan de pago ${FRECUENCIA[d.plan.frequency] ?? ""} sin intereses. La última cuota vence el ${fecha(d.plan.finalDueDate)}; el boleto o servicio se confirma con el pago del 100 %.`,
      { color: COLORES.suave, size: 9.5 },
    );
    pdf.space(4);
    pdf.table({
      headers: ["Cuota", "Vence", "Monto", "Pagado"],
      widths: [180, 110, 112, 102],
      rightAligned: [2, 3],
      rows: d.plan.rows.map((r) => [r.label, fecha(r.dueDate), dinero(r.amountCents), dinero(r.paidCents)]),
    });
  }

  // ---- Cancelación ----
  if (d.cancellationRules && d.cancellationRules.length > 0) {
    pdf.heading("Política de cancelación");
    pdf.text("El reembolso se calcula sobre lo pagado, según los días que falten para la salida:", { color: COLORES.suave });
    pdf.bullets(describePolicy(d.cancellationRules));
  }

  // ---- Requisitos de entrada ----
  pdf.heading("Requisitos de entrada");
  const req = d.requirements;
  if (req && req.verifiedAt && req.visaStatus !== "UNKNOWN") {
    pdf.keyValues([
      ["País", req.countryName],
      ["Pasaporte", req.passportRequired ? "Obligatorio, con vigencia suficiente" : "No obligatorio"],
      ["Visa (pasaporte dominicano)", VISA[req.visaStatus]],
      ...(req.vaccines ? ([["Vacunas", req.vaccines]] as [string, string][]) : []),
      ...(req.notes ? ([["Notas", req.notes]] as [string, string][]) : []),
      ["Verificado el", `${fecha(req.verifiedAt)}${req.sourceUrl ? ` · ${req.sourceUrl}` : ""}`],
    ]);
    pdf.text("Los requisitos pueden cambiar: confírmalos antes de viajar.", { color: COLORES.suave, size: 9 });
  } else {
    pdf.text(
      "Los requisitos de entrada (pasaporte, visa, vacunas) para este destino deben confirmarse antes de viajar. Escríbenos y te los confirmamos con la fuente oficial.",
    );
  }

  return pdf.build();
}
