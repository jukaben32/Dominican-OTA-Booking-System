// Arma los datos del PDF de una reserva a partir de lo que devuelve la base. Es una función PURA:
// aquí se decide qué ve el cliente. Nunca recibe ni devuelve el costo del proveedor ni la ganancia de la agencia.

import { formatDateTime } from "../format";
import type { BookingDetail } from "../supabase/booking-detail";
import type { DepartureRow, RequirementRow, TourRow } from "../supabase/tours-repo";
import { rulesFromSnapshot } from "../tours/cancellation";
import { passengerLabel } from "../tours/passengers";
import type { BookingDocumentData } from "./booking-document";

interface AssembleInput {
  agency: BookingDocumentData["agency"];
  generatedOn: string;
  booking: BookingDetail;
  tour: TourRow | null;
  departure: DepartureRow | null;
  requirement: RequirementRow | null;
}

export function assembleBookingDocument(input: AssembleInput): BookingDocumentData {
  const { booking, tour, departure, requirement } = input;
  const plan = booking.payment_plans[0];

  return {
    agency: input.agency,
    generatedOn: input.generatedOn,
    booking: {
      code: booking.code,
      status: booking.status,
      currency: booking.currency,
      totalCents: booking.total_cents,
      itbisCents: booking.itbis_cents,
      paidCents: booking.paid_cents,
      pnr: booking.pnr,
    },
    customer: { fullName: booking.customer.full_name, phone: booking.customer.phone_e164 },
    passengers: booking.passengers.map((p) => passengerLabel(p.full_name, p.passenger_type, p.room_type)),
    tour: tour
      ? {
          title: tour.title,
          destination: tour.destination,
          durationDays: tour.duration_days,
          departsOn: departure?.departs_on ?? null,
          returnsOn: departure?.returns_on ?? null,
          saleClosesOn: departure?.sale_closes_on ?? null,
          includes: tour.includes,
          excludes: tour.excludes,
          itinerary: tour.itinerary,
        }
      : null,
    segments: booking.flight_segments.map((s) => ({
      airline: s.airline, origin: s.origin_iata, dest: s.dest_iata, departsAt: formatDateTime(s.departs_at),
    })),
    plan: plan
      ? {
          frequency: plan.frequency,
          finalDueDate: plan.final_due_date,
          rows: [...plan.installments]
            .sort((a, b) => a.sequence - b.sequence)
            .map((c) => ({
              label: c.kind === "DOWN_PAYMENT" ? "Abono inicial" : `Cuota ${c.sequence}`,
              dueDate: c.due_date,
              amountCents: c.amount_cents,
              paidCents: c.paid_cents,
            })),
        }
      : null,
    cancellationRules: rulesFromSnapshot(booking.cancellation_snapshot)?.rules ?? null,
    // Solo se muestran requisitos con fuente y fecha de verificación; si no, el PDF dice que se confirmen
    requirements:
      requirement && requirement.visa_status !== "UNKNOWN" && requirement.verified_at
        ? {
            countryName: requirement.country_name,
            passportRequired: requirement.passport_required,
            visaStatus: requirement.visa_status,
            vaccines: requirement.vaccines,
            notes: requirement.notes,
            sourceUrl: requirement.source_url,
            verifiedAt: requirement.verified_at,
          }
        : null,
  };
}
