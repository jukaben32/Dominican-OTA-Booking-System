import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Field, inputClass } from "@/components/action-form";
import { PassengerRows } from "@/components/passenger-rows";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { formatDay } from "@/components/ui";
import { todayInSantoDomingo } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPublishedTourBySlug } from "@/lib/supabase/tours-repo";
import { departureAvailability } from "@/lib/tours/availability";
import { departurePricesFromRow } from "@/lib/tours/passengers";
import { createOnlineBookingAction } from "./actions";

// Los cupos cambian con cada reserva: no se guarda copia de la página
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Reservar — Dominican OTA Booking", robots: { index: false } };

export default async function ReservarPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const { salida: salidaId } = await searchParams;
  const hoy = todayInSantoDomingo();
  const tour = await getPublishedTourBySlug(createAdminClient(), slug, hoy);
  if (!tour) notFound();

  const salida = tour.departures.find((s) => s.id === salidaId);
  if (!salida) notFound();
  const disp = departureAvailability({
    capacity: salida.capacity, taken: salida.taken, minPassengers: salida.min_passengers,
    saleClosesOn: salida.sale_closes_on, status: salida.status, today: hoy,
  });

  if (!disp.saleOpen) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto w-full max-w-2xl px-5 py-16">
          <h1 className="font-display text-3xl font-semibold">Esta salida ya no está disponible</h1>
          <p className="mt-3 text-muted">Se agotaron los cupos o cerró la venta. Mira otras fechas del mismo viaje.</p>
          <Link href={`/tours/${tour.slug}`} className="mt-6 inline-block font-semibold text-sea underline underline-offset-4">Ver otras salidas</Link>
        </main>
        <SiteFooter />
      </>
    );
  }

  const formToken = crypto.randomUUID(); // un doble clic no crea dos reservas
  const precios = departurePricesFromRow(salida);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-5 py-12">
        <Link href={`/tours/${tour.slug}`} className="text-sm font-semibold text-sea underline underline-offset-4">← Volver al tour</Link>
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight">Reservar: {tour.title}</h1>
        <p className="mt-2 text-muted">
          Salida {formatDay(salida.departs_on)} → {formatDay(salida.returns_on)} · desde {formatMoney(salida.price_per_person_cents, tour.currency)} por adulto en habitación doble.
        </p>
        <p className="mt-3 rounded-lg border border-line bg-paper px-4 py-3 text-sm">
          Reservar <strong>no te cobra nada ahora</strong>: guardamos tu cupo por 48 horas y te mostramos cómo pagar por transferencia.
          Si no pagas a tiempo, el cupo se libera solo.
        </p>

        <ActionForm action={createOnlineBookingAction} submitLabel="Reservar mi cupo" className="mt-8">
          <input type="hidden" name="formToken" value={formToken} />
          <input type="hidden" name="departureId" value={salida.id} />

          <fieldset>
            <legend className="font-display text-xl font-semibold">Viajeros</legend>
            <p className="mb-4 mt-1 text-sm text-muted">
              Escribe el nombre como aparece en el pasaporte. Hay {disp.seatsLeft} cupos disponibles. El precio se calcula solo.
            </p>
            <PassengerRows prices={precios} currency={tour.currency} returnsOn={salida.returns_on} seatsLeft={disp.seatsLeft} />
          </fieldset>

          <fieldset className="mt-10">
            <legend className="font-display text-xl font-semibold">Tus datos de contacto</legend>
            <div className="mt-4 grid gap-5 md:grid-cols-2">
              <Field label="Tu nombre completo" name="customerName">
                <input id="customerName" name="customerName" required minLength={2} maxLength={120} autoComplete="name" className={inputClass} />
              </Field>
              <Field label="Teléfono (con WhatsApp)" name="phone" hint="Ejemplos: 809-555-0100 o +1 305 555 0100">
                <input id="phone" name="phone" type="tel" required maxLength={40} autoComplete="tel" className={inputClass} />
              </Field>
              <Field label="Correo" name="email" hint="Opcional" className="md:col-span-2">
                <input id="email" name="email" type="email" maxLength={254} autoComplete="email" className={inputClass} />
              </Field>
            </div>

            {/* Trampa para robots: oculta a la vista y a los lectores de pantalla; una persona no la llena */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label htmlFor="website">No llenar este campo</label>
              <input id="website" name="website" tabIndex={-1} autoComplete="off" />
            </div>

            <label className="mt-6 flex items-start gap-3 text-sm">
              <input type="checkbox" name="consent" required className="mt-1 size-4" />
              <span>
                Acepto el tratamiento de mis datos personales para gestionar esta reserva (Ley 172-13) y las{" "}
                <Link href={`/tours/${tour.slug}#t-can`} className="font-semibold text-sea underline underline-offset-4" target="_blank">condiciones de cancelación</Link> del viaje.
              </span>
            </label>
          </fieldset>
        </ActionForm>
      </main>
      <SiteFooter />
    </>
  );
}
