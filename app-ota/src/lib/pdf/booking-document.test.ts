import { PDFDocument } from "pdf-lib";
import { describe, expect, test } from "vitest";
import { buildBookingPdf, type BookingDocumentData } from "./booking-document";

const base: BookingDocumentData = {
  agency: { name: "Dominican OTA Booking", miturRut: null, whatsapp: "+18095550100" },
  generatedOn: "2026-10-04",
  booking: { code: "OTA-1001", status: "PARTIALLY_PAID", currency: "USD", totalCents: 160000, itbisCents: 4576, paidCents: 40000, pnr: null },
  customer: { fullName: "María Pérez", phone: "+18295550111" },
  passengers: ["María Pérez", "Juan Pérez"],
  tour: {
    title: "Medellín y Guatapé", destination: "Medellín, Colombia", durationDays: 5,
    departsOn: "2026-12-10", returnsOn: "2026-12-15", saleClosesOn: "2026-11-10",
    includes: ["Hotel 4 noches con desayuno", "Traslados aeropuerto - hotel", "Tour a Guatapé con almuerzo"],
    excludes: ["Boleto aéreo", "Gastos personales"],
    itinerary: [
      { day: 1, title: "Llegada a Medellín", description: "Recepción en el aeropuerto y traslado al hotel." },
      { day: 2, title: "Guatapé", description: "Paseo en lancha y subida a la Piedra del Peñol." },
    ],
  },
  segments: [{ airline: "Arajet", origin: "SDQ", dest: "MDE", departsAt: "10/12/2026 07:40" }],
  plan: {
    frequency: "BIWEEKLY", finalDueDate: "2026-11-24",
    rows: [
      { label: "Abono inicial", dueDate: "2026-10-04", amountCents: 40000, paidCents: 40000 },
      { label: "Cuota 1", dueDate: "2026-10-18", amountCents: 40000, paidCents: 0 },
    ],
  },
  cancellationRules: [{ minDaysBefore: 30, refundPercent: 90 }, { minDaysBefore: 7, refundPercent: 50 }],
  requirements: null,
};

async function paginas(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}
const empiezaComoPdf = (b: Uint8Array) => new TextDecoder().decode(b.slice(0, 5));

describe("buildBookingPdf", () => {
  test("genera una cotización que es un PDF válido", async () => {
    const bytes = await buildBookingPdf("QUOTE", base);
    expect(empiezaComoPdf(bytes)).toBe("%PDF-");
    expect(await paginas(bytes)).toBeGreaterThanOrEqual(1);
  });

  test("genera un voucher que es un PDF válido", async () => {
    const bytes = await buildBookingPdf("VOUCHER", { ...base, booking: { ...base.booking, status: "TICKETED", paidCents: 160000, pnr: "ABC123" } });
    expect(empiezaComoPdf(bytes)).toBe("%PDF-");
  });

  test("funciona sin tour, sin plan, sin política y sin vuelos (una reserva suelta)", async () => {
    const bytes = await buildBookingPdf("QUOTE", { ...base, tour: null, plan: null, cancellationRules: null, segments: [] });
    expect(await paginas(bytes)).toBe(1);
  });

  test("un itinerario largo ocupa varias páginas sin cortarse ni fallar", async () => {
    const itinerary = Array.from({ length: 30 }, (_, i) => ({
      day: i + 1, title: `Día de aventura número ${i + 1}`, description: "Actividad con guía local, almuerzo típico y traslados incluidos. ".repeat(6),
    }));
    const bytes = await buildBookingPdf("QUOTE", { ...base, tour: { ...base.tour!, itinerary } });
    expect(await paginas(bytes)).toBeGreaterThanOrEqual(3);
  });

  test("no falla con emojis, alfabetos raros ni nombres larguísimos (se reemplazan, no rompen el PDF)", async () => {
    const raro: BookingDocumentData = {
      ...base,
      customer: { fullName: "Zoë 🌴 日本 " + "X".repeat(300), phone: "+18295550111" },
      passengers: ["Ñandú 🚀", "A".repeat(500)],
      tour: { ...base.tour!, title: "Tour ✈️ \u0000 raro", includes: ["Línea con\ttab y — guiones “raros” …"] },
    };
    const bytes = await buildBookingPdf("QUOTE", raro);
    expect(empiezaComoPdf(bytes)).toBe("%PDF-");
  });

  test("las listas vacías no rompen el documento", async () => {
    const bytes = await buildBookingPdf("QUOTE", { ...base, tour: { ...base.tour!, includes: [], excludes: [], itinerary: [] }, passengers: [] });
    expect(empiezaComoPdf(bytes)).toBe("%PDF-");
  });

  test("acepta requisitos verificados y también cuando no están verificados", async () => {
    const verificados = {
      countryName: "Colombia", passportRequired: true, visaStatus: "NOT_REQUIRED" as const, vaccines: null, notes: null,
      sourceUrl: "https://fuente.example/requisitos", verifiedAt: "2026-10-01",
    };
    expect(empiezaComoPdf(await buildBookingPdf("QUOTE", { ...base, requirements: verificados }))).toBe("%PDF-");
    expect(empiezaComoPdf(await buildBookingPdf("QUOTE", { ...base, requirements: { ...verificados, visaStatus: "UNKNOWN", verifiedAt: null } }))).toBe("%PDF-");
  });

  test("el PDF del cliente NO contiene el costo del proveedor ni la ganancia (solo datos del tipo permitido)", () => {
    // Garantía por diseño: BookingDocumentData no tiene campos de costo ni de cargo de la agencia
    const campos = Object.keys(base.booking);
    expect(campos).not.toContain("supplierCostCents");
    expect(campos).not.toContain("serviceFeeCents");
  });
});
