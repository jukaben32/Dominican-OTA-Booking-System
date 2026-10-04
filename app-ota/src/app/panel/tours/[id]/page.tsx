import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm, Field, inputClass } from "@/components/action-form";
import { Etiqueta, formatDay } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTour, listDepartures, listPolicies } from "@/lib/supabase/tours-repo";
import { departureAvailability } from "@/lib/tours/availability";
import { todayInSantoDomingo } from "@/lib/dates";
import { tourImageUrl } from "@/lib/tours/image-url";
import { createDepartureAction, removeTourImageAction, updateTourAction, uploadTourImageAction } from "../actions";
import { DepartureFields } from "../departure-fields";
import { TourFields } from "../tour-fields";

const ESTADO: Record<string, string> = { DRAFT: "Borrador", OPEN: "Abierta", CLOSED: "Cerrada", CANCELLED: "Cancelada" };

export default async function TourPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { guardado } = await searchParams;

  const db = createAdminClient();
  const [tour, policies, departures] = await Promise.all([getTour(db, id), listPolicies(db), listDepartures(db, id)]);
  if (!tour) notFound();
  const hoy = todayInSantoDomingo();
  const portada = tourImageUrl(tour.cover_path);

  return (
    <>
      <Link href="/panel/tours" className="text-sm font-semibold text-sea underline underline-offset-4">← Volver a tours</Link>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <h1 className="font-display text-4xl font-semibold tracking-tight">{tour.title}</h1>
        <Etiqueta tono={tour.published ? "ok" : "neutro"}>{tour.published ? "Publicado" : "Borrador"}</Etiqueta>
        {tour.published && (
          <Link href={`/tours/${tour.slug}`} className="text-sm font-semibold text-sea underline underline-offset-4">Ver página pública</Link>
        )}
      </div>
      {guardado && <p role="status" className="mt-4 rounded-lg border border-ok/40 bg-ok/10 px-4 py-3 text-sm font-medium text-ok">Guardado.</p>}

      {/* Salidas */}
      <section aria-labelledby="t-salidas" className="mt-8 rounded-[var(--radius-card)] border border-line bg-paper p-6 shadow-[var(--shadow-lift)]">
        <h2 id="t-salidas" className="font-display text-xl font-semibold">Salidas</h2>
        {departures.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Todavía no hay salidas. Agrega la primera abajo.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {departures.map((s) => {
              const disp = departureAvailability({
                capacity: s.capacity, taken: s.taken, minPassengers: s.min_passengers,
                saleClosesOn: s.sale_closes_on, status: s.status, today: hoy,
              });
              return (
                <li key={s.id} className="grid gap-2 py-4 md:grid-cols-[1.4fr_1fr_auto] md:items-center">
                  <div>
                    <Link href={`/panel/tours/${tour.id}/salidas/${s.id}`} className="font-bold underline decoration-line underline-offset-4 hover:decoration-coral">
                      {formatDay(s.departs_on)} → {formatDay(s.returns_on)}
                    </Link>
                    <p className="text-sm text-muted">{formatMoney(s.price_per_person_cents, tour.currency)} por persona · vende hasta {formatDay(s.sale_closes_on)}</p>
                  </div>
                  <p className="text-sm">
                    <strong>{s.taken}</strong> de {s.capacity} cupos
                    {disp.confirmed ? " · confirmada" : ` · faltan ${disp.missingToConfirm} para confirmar`}
                  </p>
                  <Etiqueta tono={s.status === "OPEN" ? "ok" : s.status === "CANCELLED" ? "malo" : "neutro"}>{ESTADO[s.status]}</Etiqueta>
                </li>
              );
            })}
          </ul>
        )}
        <ActionForm action={createDepartureAction} submitLabel="Agregar salida" variant="quiet" className="mt-6 border-t border-line pt-6">
          <h3 className="mb-4 text-sm font-bold">Nueva salida</h3>
          <DepartureFields tourId={tour.id} allowOpen={false} />
        </ActionForm>
      </section>

      {/* Fotos */}
      <section aria-labelledby="t-fotos" className="mt-6 rounded-[var(--radius-card)] border border-line bg-paper p-6 shadow-[var(--shadow-lift)]">
        <h2 id="t-fotos" className="font-display text-xl font-semibold">Fotos</h2>
        <p className="mt-1 text-sm text-muted">JPG, PNG o WebP de hasta 3 MB. La portada se ve en la lista y arriba de la página; la galería admite hasta 6 fotos.</p>
        <div className="mt-4 flex flex-wrap gap-4">
          {[tour.cover_path, ...tour.gallery_paths].filter((p): p is string => Boolean(p)).map((ruta) => {
            const url = tourImageUrl(ruta);
            return (
              <figure key={ruta} className="w-40">
                {url && <Image src={url} alt="" width={160} height={110} className="h-28 w-40 rounded-lg border border-line object-cover" />}
                <figcaption className="mt-1 flex items-center justify-between text-xs text-muted">
                  <span>{ruta === tour.cover_path ? "Portada" : "Galería"}</span>
                  <form action={removeTourImageAction}>
                    <input type="hidden" name="tourId" value={tour.id} />
                    <input type="hidden" name="path" value={ruta} />
                    <button type="submit" className="font-semibold text-bad underline">Quitar</button>
                  </form>
                </figcaption>
              </figure>
            );
          })}
          {!portada && tour.gallery_paths.length === 0 && <p className="text-sm text-muted">Todavía no hay fotos.</p>}
        </div>
        <ActionForm action={uploadTourImageAction} submitLabel="Subir foto" variant="quiet" className="mt-5 max-w-lg">
          <input type="hidden" name="tourId" value={tour.id} />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Tipo" name="kind">
              <select id="kind" name="kind" className={inputClass} defaultValue="gallery">
                <option value="cover">Portada (reemplaza la actual)</option>
                <option value="gallery">Galería</option>
              </select>
            </Field>
            <Field label="Archivo" name="file">
              <input id="file" name="file" type="file" accept="image/jpeg,image/png,image/webp" required className={inputClass} />
            </Field>
          </div>
        </ActionForm>
      </section>

      {/* Datos del tour */}
      <section aria-labelledby="t-datos" className="mt-6">
        <h2 id="t-datos" className="font-display text-2xl font-semibold">Datos del tour</h2>
        <ActionForm action={updateTourAction} submitLabel="Guardar cambios" className="mt-4 max-w-3xl">
          <input type="hidden" name="tourId" value={tour.id} />
          <TourFields tour={tour} policies={policies} />
        </ActionForm>
      </section>
    </>
  );
}
