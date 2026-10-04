import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm, Field, inputClass } from "@/components/action-form";
import { formatDay } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { todayInSantoDomingo } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { getDeparture, getTour } from "@/lib/supabase/tours-repo";
import { departureAvailability } from "@/lib/tours/availability";
import { describePolicy, validateRules } from "@/lib/tours/cancellation";
import { createAdminClient } from "@/lib/supabase/admin";
import { PassengerRows } from "@/components/passenger-rows";
import { departurePricesFromRow } from "@/lib/tours/passengers";
import { sellDepartureAction } from "./actions";

export default async function VenderSalidaPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const db = await createClient(); // con la sesión del agente: la seguridad por filas decide qué ve
  const salida = await getDeparture(db, id);
  if (!salida) notFound();
  const tour = await getTour(db, salida.tour_id);
  if (!tour) notFound();

  // La política se lee para MOSTRARLE al agente lo que prometerá al cliente (no contiene costos)
  let lineasPolitica: string[] = [];
  if (tour.cancellation_policy_id) {
    const { data } = await createAdminClient().from("cancellation_policies").select("rules").eq("id", tour.cancellation_policy_id).maybeSingle();
    if (data) {
      lineasPolitica = describePolicy(validateRules(data.rules));
    }
  }

  const disp = departureAvailability({
    capacity: salida.capacity, taken: salida.taken, minPassengers: salida.min_passengers,
    saleClosesOn: salida.sale_closes_on, status: salida.status, today: todayInSantoDomingo(),
  });
  const formToken = crypto.randomUUID(); // un doble clic no crea dos reservas

  return (
    <>
      <Link href="/panel/salidas" className="text-sm font-semibold text-sea underline underline-offset-4">← Volver a las salidas</Link>
      <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight">{tour.title}</h1>
      <p className="mt-2 text-muted">
        {tour.destination} · sale {formatDay(salida.departs_on)} · regresa {formatDay(salida.returns_on)} ·{" "}
        <strong>{formatMoney(salida.price_per_person_cents, tour.currency)}</strong> por adulto en habitación doble (todo incluido)
      </p>
      <p className="mt-1 text-xs text-muted">
        {salida.single_supplement_cents !== null && <>Habitación individual: +{formatMoney(salida.single_supplement_cents, tour.currency)} · </>}
        {salida.child_price_cents !== null && <>Niño: {formatMoney(salida.child_price_cents, tour.currency)} · </>}
        Infante: {salida.infant_price_cents === 0 ? "gratis" : formatMoney(salida.infant_price_cents, tour.currency)} (sin cupo) · niño hasta {salida.child_max_age} años, infante hasta {salida.infant_max_age}
      </p>
      <p className="mt-1 text-sm">
        Quedan <strong>{disp.seatsLeft}</strong> de {salida.capacity} cupos · {disp.confirmed ? "salida confirmada" : `faltan ${disp.missingToConfirm} pasajeros para confirmar`}
      </p>

      {!disp.saleOpen ? (
        <p className="mt-8 rounded-lg border border-bad/40 bg-bad/10 px-4 py-3 text-sm font-medium text-bad">
          Esta salida no está disponible para la venta
          {disp.reason === "AGOTADA" ? ": se agotaron los cupos." : disp.reason === "VENTA_CERRADA" ? ": la venta ya cerró." : "."}
        </p>
      ) : (
        <ActionForm action={sellDepartureAction} submitLabel="Crear reserva" className="mt-8 max-w-3xl space-y-8">
          <input type="hidden" name="formToken" value={formToken} />
          <input type="hidden" name="departureId" value={salida.id} />
          <fieldset className="rounded-[var(--radius-card)] border border-line bg-paper p-6">
            <legend className="px-2 font-display text-xl font-semibold">Cliente</legend>
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Nombre completo" name="customerName"><input id="customerName" name="customerName" required minLength={2} maxLength={120} autoComplete="off" className={inputClass} /></Field>
              <Field label="Teléfono (WhatsApp)" name="phone" hint="Ej. 809-555-0100. Para otros países empieza con +"><input id="phone" name="phone" type="tel" required autoComplete="off" className={inputClass} /></Field>
              <Field label="Correo (opcional)" name="email"><input id="email" name="email" type="email" maxLength={254} autoComplete="off" className={inputClass} /></Field>
              <label className="flex items-start gap-3 self-end pb-3 text-sm">
                <input type="checkbox" name="whatsappOptIn" className="mt-1 h-5 w-5 accent-[var(--coral)]" />
                <span>El cliente <strong>aceptó</strong> recibir mensajes por WhatsApp sobre su reserva.</span>
              </label>
            </div>
          </fieldset>
          <fieldset className="rounded-[var(--radius-card)] border border-line bg-paper p-6">
            <legend className="px-2 font-display text-xl font-semibold">Pasajeros</legend>
            <p className="mb-4 text-sm text-muted">
              Nombre como aparece en el pasaporte. Máximo 9 por reserva y {disp.seatsLeft} cupos disponibles. El precio se calcula solo según el
              tipo de pasajero y la habitación.
            </p>
            <PassengerRows prices={departurePricesFromRow(salida)} currency={tour.currency} returnsOn={salida.returns_on} seatsLeft={disp.seatsLeft} />
          </fieldset>
          {lineasPolitica.length > 0 && (
            <div className="rounded-[var(--radius-card)] border border-line bg-paper p-6">
              <h2 className="font-display text-lg font-semibold">Política de cancelación que se le promete al cliente</h2>
              <ul className="mt-2 list-disc pl-5 text-sm text-muted">{lineasPolitica.map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
          )}
        </ActionForm>
      )}
    </>
  );
}
