import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { formatDay } from "@/components/ui";
import { whatsappLink } from "@/lib/company";
import { todayInSantoDomingo } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { listPublishedTours, type PublicTour } from "@/lib/supabase/tours-repo";
import { departureAvailability } from "@/lib/tours/availability";
import { tourImageUrl } from "@/lib/tours/image-url";

export const metadata: Metadata = {
  title: "Tours y paquetes — Dominican OTA Booking",
  description: "Tours con alojamiento, traslados y guía incluidos, con salidas desde República Dominicana y pagos flexibles.",
};

// Se calcula en cada visita: los cupos cambian con cada reserva
export const dynamic = "force-dynamic";

function resumenSalidas(tour: PublicTour, hoy: string) {
  const abiertas = tour.departures
    .map((s) => ({ s, disp: departureAvailability({ capacity: s.capacity, taken: s.taken, minPassengers: s.min_passengers, saleClosesOn: s.sale_closes_on, status: s.status, today: hoy }) }))
    .filter((x) => x.disp.saleOpen);
  if (abiertas.length === 0) return null;
  const desde = Math.min(...abiertas.map((x) => x.s.price_per_person_cents));
  return { desde, proxima: abiertas[0].s.departs_on, cantidad: abiertas.length };
}

export default async function ToursPage() {
  const hoy = todayInSantoDomingo();
  const tours = await listPublishedTours(createAdminClient(), hoy);
  const consulta = whatsappLink("Hola, quiero información sobre sus tours");

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-5">
        <p className="mt-6 text-sm font-semibold uppercase tracking-[0.22em] text-coral-deep">Tours y paquetes</p>
        <h1 className="mt-3 max-w-3xl font-display text-[clamp(2.4rem,6vw,4.4rem)] font-semibold leading-[1.02] tracking-tight">
          Viaja todo incluido, <em className="font-medium text-coral-deep">sin complicarte.</em>
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">
          Alojamiento, traslados y guía incluidos. Salidas con fecha fija, precio claro y la opción de apartar con un abono y
          completar en pagos programados, sin intereses.
        </p>

        {tours.length === 0 ? (
          <div className="mt-14 rounded-[var(--radius-card)] border border-dashed border-line bg-paper px-6 py-16 text-center">
            <p className="font-display text-2xl font-semibold">Estamos preparando las primeras salidas.</p>
            <p className="mx-auto mt-2 max-w-md text-muted">Escríbenos y te avisamos apenas abramos las fechas de tu destino favorito.</p>
            {consulta && <a href={consulta} className="mt-6 inline-block rounded-full bg-coral px-7 py-3.5 font-bold text-[#1a0a04]">Escríbenos por WhatsApp</a>}
          </div>
        ) : (
          <ul className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {tours.map((t) => {
              const r = resumenSalidas(t, hoy);
              const portada = tourImageUrl(t.cover_path);
              return (
                <li key={t.id}>
                  <Link href={`/tours/${t.slug}`} className="group block overflow-hidden rounded-[var(--radius-card)] border border-line bg-paper shadow-[var(--shadow-lift)] transition-transform hover:-translate-y-1">
                    <div className="relative h-52 bg-sea-deep">
                      {portada && <Image src={portada} alt="" fill sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw" className="object-cover" />}
                      <span className="absolute left-3 top-3 rounded-full bg-paper/95 px-3 py-1 text-xs font-bold text-ink">{t.duration_days} días</span>
                    </div>
                    <div className="p-6">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">{t.destination}</p>
                      <h2 className="mt-1 font-display text-2xl font-semibold leading-tight group-hover:text-coral-deep">{t.title}</h2>
                      <p className="mt-2 text-sm leading-relaxed text-muted">{t.summary}</p>
                      <p className="mt-4 text-sm">
                        {r ? (
                          <>
                            <span className="text-muted">Desde </span>
                            <strong className="text-lg">{formatMoney(r.desde, t.currency)}</strong>
                            <span className="text-muted"> por persona · próxima salida {formatDay(r.proxima)}</span>
                          </>
                        ) : (
                          <span className="text-muted">Próximas fechas: consúltanos</span>
                        )}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
