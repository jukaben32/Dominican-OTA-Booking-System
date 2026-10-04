import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { formatDay } from "@/components/ui";
import { whatsappLink } from "@/lib/company";
import { todayInSantoDomingo } from "@/lib/dates";
import { serializeJsonLd } from "@/lib/json-ld";
import { formatMoney } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPublishedTourBySlug, getVerifiedRequirement } from "@/lib/supabase/tours-repo";
import { departureAvailability } from "@/lib/tours/availability";
import { describePolicy } from "@/lib/tours/cancellation";
import { tourImageUrl } from "@/lib/tours/image-url";

// Los cupos cambian con cada reserva: no se guarda copia de la página
export const dynamic = "force-dynamic";

const VISA: Record<string, string> = {
  NOT_REQUIRED: "No se requiere visa", REQUIRED: "Se requiere visa", ON_ARRIVAL: "Visa a la llegada", E_VISA: "Visa electrónica",
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const tour = await getPublishedTourBySlug(createAdminClient(), slug, todayInSantoDomingo());
  if (!tour) return { title: "Tour no encontrado" };
  const portada = tourImageUrl(tour.cover_path);
  return {
    title: `${tour.title} — Dominican OTA Booking`,
    description: tour.summary,
    openGraph: { title: tour.title, description: tour.summary, images: portada ? [portada] : [] },
  };
}

export default async function TourPublicoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const hoy = todayInSantoDomingo();
  const db = createAdminClient();
  const tour = await getPublishedTourBySlug(db, slug, hoy);
  if (!tour) notFound();

  const requisitos = await getVerifiedRequirement(db, tour.country_code);
  const portada = tourImageUrl(tour.cover_path);
  const galeria = tour.gallery_paths.map(tourImageUrl).filter((u): u is string => Boolean(u));

  const salidas = tour.departures.map((s) => ({
    s,
    disp: departureAvailability({ capacity: s.capacity, taken: s.taken, minPassengers: s.min_passengers, saleClosesOn: s.sale_closes_on, status: s.status, today: hoy }),
  }));
  const abiertas = salidas.filter((x) => x.disp.saleOpen);
  const desde = abiertas.length ? Math.min(...abiertas.map((x) => x.s.price_per_person_cents)) : null;

  const datosEstructurados = {
    "@context": "https://schema.org",
    "@type": "TouristTrip",
    name: tour.title,
    description: tour.summary,
    touristType: "Viajeros desde República Dominicana",
    ...(portada && { image: portada }),
    ...(abiertas.length && {
      offers: abiertas.map(({ s }) => ({
        "@type": "Offer",
        price: (s.price_per_person_cents / 100).toFixed(2),
        priceCurrency: tour.currency,
        availability: "https://schema.org/InStock",
        validFrom: hoy,
        validThrough: s.sale_closes_on,
      })),
    }),
  };

  return (
    <>
      <SiteHeader />
      <main>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(datosEstructurados) }} />

        <section className="mx-auto w-full max-w-6xl px-5">
          <Link href="/tours" className="text-sm font-semibold text-sea underline underline-offset-4">← Todos los tours</Link>
          <p className="mt-5 text-sm font-semibold uppercase tracking-[0.22em] text-coral-deep">{tour.destination} · {tour.duration_days} días</p>
          <h1 className="mt-3 max-w-4xl font-display text-[clamp(2.4rem,6vw,4.6rem)] font-semibold leading-[1.02] tracking-tight">{tour.title}</h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">{tour.summary}</p>
          {desde !== null && (
            <p className="mt-6 text-lg">
              <span className="text-muted">Desde </span>
              <strong className="font-display text-3xl">{formatMoney(desde, tour.currency)}</strong>
              <span className="text-muted"> por persona, todo incluido</span>
            </p>
          )}
        </section>

        {portada && (
          <div className="relative mx-auto mt-10 h-[min(60vh,520px)] w-full max-w-6xl overflow-hidden rounded-[var(--radius-card)] border border-line md:mx-auto">
            <Image src={portada} alt={`Vista del tour ${tour.title}`} fill priority sizes="(min-width: 1152px) 1152px, 100vw" className="object-cover" />
          </div>
        )}

        <div className="mx-auto mt-14 grid w-full max-w-6xl gap-12 px-5 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-14">
            {tour.description && (
              <section aria-labelledby="t-desc">
                <h2 id="t-desc" className="font-display text-3xl font-semibold">Sobre este viaje</h2>
                <p className="mt-4 whitespace-pre-line leading-relaxed text-muted">{tour.description}</p>
              </section>
            )}

            {tour.itinerary.length > 0 && (
              <section aria-labelledby="t-iti">
                <h2 id="t-iti" className="font-display text-3xl font-semibold">Itinerario día por día</h2>
                <ol className="mt-6 space-y-6 border-l-2 border-line pl-6">
                  {tour.itinerary.map((d) => (
                    <li key={d.day} className="relative">
                      <span aria-hidden="true" className="absolute -left-[2.15rem] top-0 flex h-7 w-7 items-center justify-center rounded-full bg-coral text-xs font-bold text-[#1a0a04]">{d.day}</span>
                      <h3 className="font-bold">{d.title}</h3>
                      {d.description && <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-muted">{d.description}</p>}
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {(tour.includes.length > 0 || tour.excludes.length > 0) && (
              <section aria-labelledby="t-inc" className="grid gap-8 md:grid-cols-2">
                <h2 id="t-inc" className="sr-only">Qué incluye y qué no</h2>
                {tour.includes.length > 0 && (
                  <div>
                    <h3 className="font-display text-xl font-semibold text-ok">Incluye</h3>
                    <ul className="mt-3 space-y-2 text-sm">{tour.includes.map((i) => <li key={i} className="flex gap-2"><span aria-hidden="true" className="text-ok">✓</span>{i}</li>)}</ul>
                  </div>
                )}
                {tour.excludes.length > 0 && (
                  <div>
                    <h3 className="font-display text-xl font-semibold text-muted">No incluye</h3>
                    <ul className="mt-3 space-y-2 text-sm text-muted">{tour.excludes.map((i) => <li key={i} className="flex gap-2"><span aria-hidden="true">–</span>{i}</li>)}</ul>
                  </div>
                )}
              </section>
            )}

            {galeria.length > 0 && (
              <section aria-labelledby="t-gal">
                <h2 id="t-gal" className="sr-only">Galería de fotos</h2>
                <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  {galeria.map((url) => (
                    <li key={url} className="relative h-40 overflow-hidden rounded-xl border border-line">
                      <Image src={url} alt="" fill sizes="(min-width: 768px) 33vw, 50vw" className="object-cover" />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section aria-labelledby="t-req">
              <h2 id="t-req" className="font-display text-3xl font-semibold">Requisitos para viajar</h2>
              {requisitos ? (
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex gap-3"><dt className="w-48 text-muted">Pasaporte</dt><dd>{requisitos.passport_required ? "Obligatorio, con vigencia suficiente" : "No obligatorio"}</dd></div>
                  <div className="flex gap-3"><dt className="w-48 text-muted">Visa (pasaporte dominicano)</dt><dd className="font-semibold">{VISA[requisitos.visa_status]}</dd></div>
                  {requisitos.vaccines && <div className="flex gap-3"><dt className="w-48 text-muted">Vacunas</dt><dd>{requisitos.vaccines}</dd></div>}
                  {requisitos.notes && <div className="flex gap-3"><dt className="w-48 text-muted">Notas</dt><dd>{requisitos.notes}</dd></div>}
                  <div className="pt-2 text-xs text-muted">Verificado el {formatDay(requisitos.verified_at!)}. Los requisitos pueden cambiar: confírmalos con nosotros antes de viajar.</div>
                </dl>
              ) : (
                <p className="mt-4 text-sm leading-relaxed text-muted">
                  Los requisitos de entrada (pasaporte, visa y vacunas) para tu pasaporte se confirman al cotizar. Escríbenos y te los indicamos con la fuente oficial.
                </p>
              )}
            </section>

            {tour.policyRules && (
              <section aria-labelledby="t-can">
                <h2 id="t-can" className="font-display text-3xl font-semibold">Si necesitas cancelar</h2>
                <p className="mt-3 text-sm text-muted">El reembolso se calcula sobre lo que hayas pagado, según los días que falten para la salida:</p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{describePolicy(tour.policyRules).map((l) => <li key={l}>{l}</li>)}</ul>
              </section>
            )}
          </div>

          {/* Salidas */}
          <aside aria-labelledby="t-salidas" className="lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-[var(--radius-card)] border border-line bg-paper p-6 shadow-[var(--shadow-lift)]">
              <h2 id="t-salidas" className="font-display text-2xl font-semibold">Próximas salidas</h2>
              {salidas.length === 0 ? (
                <p className="mt-3 text-sm text-muted">No hay fechas abiertas por ahora. Escríbenos y te avisamos cuando abramos la próxima.</p>
              ) : (
                <ul className="mt-4 space-y-4">
                  {salidas.map(({ s, disp }) => {
                    const enlace = whatsappLink(`Hola, quiero reservar el tour "${tour.title}" con salida el ${formatDay(s.departs_on)}`);
                    return (
                      <li key={s.id} className="rounded-xl border border-line bg-sand p-4">
                        <p className="font-bold">{formatDay(s.departs_on)} → {formatDay(s.returns_on)}</p>
                        <p className="mt-1 text-lg font-bold">{formatMoney(s.price_per_person_cents, tour.currency)} <span className="text-sm font-normal text-muted">por adulto en habitación doble</span></p>
                        <ul className="mt-1 space-y-0.5 text-xs text-muted">
                          {s.single_supplement_cents !== null && <li>Habitación individual: +{formatMoney(s.single_supplement_cents, tour.currency)}</li>}
                          {s.child_price_cents !== null && <li>Niños (hasta {s.child_max_age} años): {formatMoney(s.child_price_cents, tour.currency)}</li>}
                          <li>Infantes (hasta {s.infant_max_age} {s.infant_max_age === 1 ? "año" : "años"}): {s.infant_price_cents === 0 ? "gratis" : formatMoney(s.infant_price_cents, tour.currency)}, sin ocupar cupo</li>
                        </ul>
                        <p className="mt-1 text-xs text-muted">
                          {disp.soldOut ? "Cupos agotados" : disp.seatsLeft <= 5 ? `¡Últimos ${disp.seatsLeft} cupos!` : `${disp.seatsLeft} cupos disponibles`} ·{" "}
                          {disp.confirmed ? "salida confirmada" : "se confirma al llegar al mínimo de viajeros"} · vende hasta el {formatDay(s.sale_closes_on)}
                        </p>
                        {disp.saleOpen && (
                          <Link href={`/tours/${tour.slug}/reservar?salida=${s.id}`} className="mt-3 block rounded-full bg-ink px-5 py-3 text-center text-sm font-bold text-sand transition-transform hover:-translate-y-0.5">
                            Reservar en línea
                          </Link>
                        )}
                        {disp.saleOpen && enlace && (
                          <a href={enlace} className="mt-3 block rounded-full bg-coral px-5 py-3 text-center text-sm font-bold text-[#1a0a04] transition-transform hover:-translate-y-0.5">
                            Prefiero reservar por WhatsApp
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-5 text-xs leading-relaxed text-muted">
                Puedes apartar tu cupo con un abono y completar el pago en cuotas programadas, sin intereses, siempre antes de la fecha límite de la salida.
              </p>
            </div>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
