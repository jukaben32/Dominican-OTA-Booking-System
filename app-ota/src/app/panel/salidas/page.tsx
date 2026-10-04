import Link from "next/link";
import { EmptyState, Etiqueta, formatDay } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { todayInSantoDomingo } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { listSellableDepartures } from "@/lib/supabase/tours-repo";
import { departureAvailability } from "@/lib/tours/availability";

export default async function SalidasPage() {
  await requireStaff();
  const hoy = todayInSantoDomingo();
  const salidas = await listSellableDepartures(await createClient(), hoy);

  return (
    <>
      <h1 className="font-display text-4xl font-semibold tracking-tight">Vender salidas</h1>
      <p className="mt-2 max-w-2xl text-muted">Salidas de tours abiertas a la venta, con sus cupos. Elige una para crear la reserva del cliente.</p>

      <div className="mt-8">
        {salidas.length === 0 ? (
          <EmptyState>No hay salidas abiertas a la venta. Un administrador debe publicar una en &quot;Tours&quot;.</EmptyState>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-paper shadow-[var(--shadow-lift)]">
            {salidas.map((s) => {
              const disp = departureAvailability({
                capacity: s.capacity, taken: s.taken, minPassengers: s.min_passengers,
                saleClosesOn: s.sale_closes_on, status: s.status, today: hoy,
              });
              return (
                <li key={s.id} className="grid gap-2 px-6 py-5 md:grid-cols-[2fr_1.2fr_auto] md:items-center">
                  <div>
                    <Link href={`/panel/salidas/${s.id}`} className="font-display text-xl font-semibold underline decoration-line underline-offset-4 hover:decoration-coral">
                      {s.tour.title}
                    </Link>
                    <p className="text-sm text-muted">
                      {s.tour.destination} · sale {formatDay(s.departs_on)} · regresa {formatDay(s.returns_on)} · {formatMoney(s.price_per_person_cents, s.tour.currency)} por persona
                    </p>
                  </div>
                  <p className="text-sm">
                    Quedan <strong>{disp.seatsLeft}</strong> de {s.capacity} cupos
                    <span className="block text-xs text-muted">{disp.confirmed ? "Salida confirmada" : `Faltan ${disp.missingToConfirm} para confirmar`} · vende hasta {formatDay(s.sale_closes_on)}</span>
                  </p>
                  <Etiqueta tono={disp.saleOpen ? "ok" : "malo"}>{disp.saleOpen ? "Abierta" : "No disponible"}</Etiqueta>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
