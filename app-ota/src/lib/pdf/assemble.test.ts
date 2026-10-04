import { describe, expect, test } from "vitest";
import { bookingDetailSchema } from "../supabase/booking-detail";
import { assembleBookingDocument } from "./assemble";

const agencia = { name: "Dominican OTA Booking", miturRut: null, whatsapp: "+18095550100" };

// Una reserva como la devuelve la base (incluye campos internos que NO deben llegar al PDF)
const reserva = bookingDetailSchema.parse({
  id: "r1", code: "OTA-1001", status: "PARTIALLY_PAID", product_type: "PACKAGE", currency: "USD",
  supplier_cost_cents: 100000, service_fee_cents: 50000, itbis_cents: 9000, total_cents: 159000, paid_cents: 40000,
  price_guaranteed: true, group_block_id: null, departure_id: "d1", source: "AGENT", hold_expires_at: null, supplier_deadline: "2026-11-05T16:00:00Z", pnr: null,
  requires_review: true, review_reasons: ["SALIDA_PROXIMA"],
  cancellation_snapshot: { name: "Estándar", rules: [{ minDaysBefore: 7, refundPercent: 25 }, { minDaysBefore: 30, refundPercent: 90 }] },
  customer: { full_name: "María Pérez", phone_e164: "+18295550111", whatsapp_opt_in_at: null },
  passengers: [
    { full_name: "María Pérez", passenger_type: "ADULT", room_type: "DOUBLE" },
    { full_name: "Ana Pérez", passenger_type: "CHILD", room_type: "DOUBLE" },
  ],
  flight_segments: [{ airline: "Arajet", origin_iata: "SDQ", dest_iata: "MDE", departs_at: "2026-12-10T11:40:00Z" }],
  // La relación uno-a-uno llega como OBJETO, no como lista
  payment_plans: {
    id: "p1", status: "ACTIVE", frequency: "BIWEEKLY", final_due_date: "2026-11-24",
    installments: [
      { sequence: 2, kind: "INSTALLMENT", amount_cents: 39750, paid_cents: 0, due_date: "2026-11-01", status: "PENDING" },
      { sequence: 0, kind: "DOWN_PAYMENT", amount_cents: 39750, paid_cents: 39750, due_date: "2026-10-04", status: "PAID" },
      { sequence: 1, kind: "INSTALLMENT", amount_cents: 39750, paid_cents: 0, due_date: "2026-10-18", status: "PENDING" },
    ],
  },
  payments: [],
});

const tour = {
  id: "t1", slug: "medellin", title: "Medellín", summary: "s", description: "", country_code: "CO", destination: "Medellín",
  duration_days: 5, currency: "USD" as const, includes: ["Hotel"], excludes: ["Boleto"], itinerary: [{ day: 1, title: "Llegada", description: "" }],
  cover_path: null, gallery_paths: [], cancellation_policy_id: null, published: true,
};
const salida = {
  id: "d1", tour_id: "t1", departs_on: "2026-12-10", returns_on: "2026-12-15", capacity: 20, min_passengers: 8,
  price_per_person_cents: 79500, single_supplement_cents: null, child_price_cents: null, infant_price_cents: 0, child_max_age: 11, infant_max_age: 1, sale_closes_on: "2026-11-10", supplier_deadline: "2026-11-05T16:00:00Z", status: "OPEN" as const, notes: "NOTA INTERNA",
};
const requisito = {
  country_code: "CO", country_name: "Colombia", passport_required: true, visa_status: "NOT_REQUIRED" as const,
  vaccines: null, notes: null, source_url: "https://fuente.example", verified_at: "2026-10-01",
};

describe("assembleBookingDocument", () => {
  const datos = assembleBookingDocument({ agency: agencia, generatedOn: "2026-10-04", booking: reserva, tour, departure: salida, requirement: requisito });

  test("NUNCA incluye el costo del proveedor, la ganancia ni datos internos", () => {
    const texto = JSON.stringify(datos);
    expect(texto).not.toContain("100000"); // costo del proveedor
    expect(texto).not.toContain("50000"); // cargo de la agencia
    expect(texto).not.toContain("SALIDA_PROXIMA"); // alerta de fraude interna
    expect(texto).not.toContain("NOTA INTERNA");
    expect(texto).not.toContain("whatsapp_opt_in");
    expect(Object.keys(datos.booking)).toEqual(["code", "status", "currency", "totalCents", "itbisCents", "paidCents", "pnr"]);
  });

  test("indica el tipo de cada pasajero (niño, infante, habitación individual)", () => {
    expect(datos.passengers).toEqual(["María Pérez", "Ana Pérez (niño)"]);
  });

  test("lleva el total, el ITBIS incluido y lo pagado", () => {
    expect(datos.booking).toMatchObject({ totalCents: 159000, itbisCents: 9000, paidCents: 40000 });
  });

  test("ordena las cuotas del plan y las nombra", () => {
    expect(datos.plan?.rows.map((r) => r.label)).toEqual(["Abono inicial", "Cuota 1", "Cuota 2"]);
  });

  test("lee la política copiada en la reserva (ordenada) y no la del catálogo", () => {
    expect(datos.cancellationRules).toEqual([{ minDaysBefore: 30, refundPercent: 90 }, { minDaysBefore: 7, refundPercent: 25 }]);
  });

  test("incluye los datos del tour y las fechas de la salida", () => {
    expect(datos.tour).toMatchObject({ title: "Medellín", departsOn: "2026-12-10", returnsOn: "2026-12-15", saleClosesOn: "2026-11-10" });
  });

  test("muestra la hora del vuelo en horario dominicano", () => {
    expect(datos.segments[0].departsAt).toMatch(/7:40/);
  });

  test("solo pasa los requisitos si están verificados con fuente y fecha", () => {
    expect(datos.requirements).toMatchObject({ countryName: "Colombia", visaStatus: "NOT_REQUIRED", verifiedAt: "2026-10-01" });
    for (const r of [
      { ...requisito, visa_status: "UNKNOWN" as const },
      { ...requisito, verified_at: null },
      null,
    ]) {
      const d = assembleBookingDocument({ agency: agencia, generatedOn: "2026-10-04", booking: reserva, tour, departure: salida, requirement: r });
      expect(d.requirements).toBeNull();
    }
  });

  test("una reserva sin tour, sin plan y sin política produce un documento válido", () => {
    const suelta = { ...reserva, departure_id: null, cancellation_snapshot: null, payment_plans: [] };
    const d = assembleBookingDocument({ agency: agencia, generatedOn: "2026-10-04", booking: suelta, tour: null, departure: null, requirement: null });
    expect(d.tour).toBeNull();
    expect(d.plan).toBeNull();
    expect(d.cancellationRules).toBeNull();
  });
});
