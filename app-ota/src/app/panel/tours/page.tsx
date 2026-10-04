import Link from "next/link";
import { EmptyState, Etiqueta } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { listTours } from "@/lib/supabase/tours-repo";

export default async function ToursPage() {
  await requireAdmin();
  const tours = await listTours(createAdminClient());

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-semibold tracking-tight">Tours</h1>
          <p className="mt-2 max-w-2xl text-muted">
            El catálogo. Cada tour tiene sus salidas (fecha, cupo y precio) y los costos de cada salida, que solo ves tú.
          </p>
        </div>
        <Link href="/panel/tours/nuevo" className="rounded-full bg-coral px-6 py-3 text-sm font-bold text-[#1a0a04] shadow-[var(--shadow-lift)] transition-transform hover:-translate-y-0.5">
          Nuevo tour
        </Link>
      </div>

      <div className="mt-8">
        {tours.length === 0 ? (
          <EmptyState>Todavía no hay tours. Crea el primero con el botón &quot;Nuevo tour&quot;.</EmptyState>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-paper shadow-[var(--shadow-lift)]">
            {tours.map((t) => (
              <li key={t.id} className="grid gap-2 px-6 py-5 md:grid-cols-[2fr_1fr_auto] md:items-center">
                <div>
                  <Link href={`/panel/tours/${t.id}`} className="font-display text-xl font-semibold underline decoration-line underline-offset-4 hover:decoration-coral">
                    {t.title}
                  </Link>
                  <p className="text-sm text-muted">{t.destination} ({t.country_code}) · {t.duration_days} días · {t.currency}</p>
                </div>
                <p className="text-sm text-muted">/tours/{t.slug}</p>
                <Etiqueta tono={t.published ? "ok" : "neutro"}>{t.published ? "Publicado" : "Borrador"}</Etiqueta>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
