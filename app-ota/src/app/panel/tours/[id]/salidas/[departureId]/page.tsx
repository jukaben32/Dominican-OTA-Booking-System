import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm, Field, inputClass } from "@/components/action-form";
import { Etiqueta, formatDay } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { todayInSantoDomingo } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDeparture, getTour, listCostItems, listSuppliers } from "@/lib/supabase/tours-repo";
import { departureAvailability } from "@/lib/tours/availability";
import { costPerPax, departureEconomics, type CostItem } from "@/lib/tours/pricing";
import { addCostItemAction, cancelDepartureAction, deleteCostItemAction, updateDepartureAction } from "../../../actions";
import { DepartureFields } from "../../../departure-fields";

const CATEGORIAS: Record<string, string> = {
  LODGING: "Alojamiento", TRANSPORT: "Transporte", GUIDE: "Guía", ENTRANCE: "Entradas", MEAL: "Comidas", INSURANCE: "Seguro", OTHER: "Otro",
};

export default async function SalidaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; departureId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireAdmin();
  const { id, departureId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(departureId).success) notFound();
  const { guardado } = await searchParams;

  const db = createAdminClient();
  const [tour, salida, costos, proveedores] = await Promise.all([
    getTour(db, id), getDeparture(db, departureId), listCostItems(db, departureId), listSuppliers(db),
  ]);
  if (!tour || !salida || salida.tour_id !== tour.id) notFound();

  const hoy = todayInSantoDomingo();
  const disp = departureAvailability({
    capacity: salida.capacity, taken: salida.taken, minPassengers: salida.min_passengers,
    saleClosesOn: salida.sale_closes_on, status: salida.status, today: hoy,
  });
  const dinero = (c: number) => formatMoney(c, tour.currency);
  const volver = `/panel/tours/${tour.id}/salidas/${salida.id}`;

  // Lo que afectaría cancelar esta salida: reservas abiertas y dinero que habría que devolver
  const { data: afectadas } = await db
    .from("bookings")
    .select("paid_cents")
    .eq("departure_id", salida.id)
    .in("status", ["QUOTED", "ON_HOLD", "PENDING_PAYMENT", "PARTIALLY_PAID", "PAID", "TICKETED"]);
  const nAfectadas = afectadas?.length ?? 0;
  const aDevolver = (afectadas ?? []).reduce((suma, b) => suma + Number(b.paid_cents), 0);

  const items: CostItem[] = costos.map((c) => ({
    description: c.description, amountCents: c.amount_cents, fxRateToBase: c.fx_rate_to_base, basis: c.basis,
  }));
  const escenarios = [
    { etiqueta: "Mínimo para que salga", pax: salida.min_passengers },
    ...(salida.taken > 0 && salida.taken !== salida.min_passengers ? [{ etiqueta: "Vendidos hoy", pax: salida.taken }] : []),
    { etiqueta: "Cupo lleno", pax: salida.capacity },
  ].map((e) => ({
    ...e,
    eco: items.length > 0 ? departureEconomics({ items, pricePerPersonCents: salida.price_per_person_cents, pax: e.pax, capacity: salida.capacity }) : null,
  }));
  const equilibrio = escenarios[0].eco?.breakEvenPax ?? null;
  const nombreProveedor = new Map(proveedores.map((p) => [p.id, p.name]));

  return (
    <>
      <Link href={`/panel/tours/${tour.id}`} className="text-sm font-semibold text-sea underline underline-offset-4">← Volver a {tour.title}</Link>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          Salida {formatDay(salida.departs_on)} → {formatDay(salida.returns_on)}
        </h1>
        <Etiqueta tono={salida.status === "OPEN" ? "ok" : salida.status === "CANCELLED" ? "malo" : "neutro"}>
          {{ DRAFT: "Borrador", OPEN: "Abierta", CLOSED: "Cerrada", CANCELLED: "Cancelada" }[salida.status]}
        </Etiqueta>
      </div>
      <p className="mt-2 text-muted">
        {dinero(salida.price_per_person_cents)} por persona · <strong>{salida.taken}</strong> de {salida.capacity} cupos vendidos ·{" "}
        {disp.confirmed ? "salida confirmada" : `faltan ${disp.missingToConfirm} pasajeros para confirmar`}
        {salida.status === "OPEN" && <> · <Link href={`/panel/salidas/${salida.id}`} className="font-semibold text-sea underline underline-offset-4">Vender esta salida</Link></>}
      </p>
      {guardado && <p role="status" className="mt-4 rounded-lg border border-ok/40 bg-ok/10 px-4 py-3 text-sm font-medium text-ok">Guardado.</p>}

      {/* Economía */}
      <section aria-labelledby="t-eco" className="mt-8 rounded-[var(--radius-card)] border border-line bg-paper p-6 shadow-[var(--shadow-lift)]">
        <h2 id="t-eco" className="font-display text-xl font-semibold">¿Cuánto ganas? <span className="text-sm font-normal text-muted">(confidencial)</span></h2>
        {items.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Carga los costos de abajo para ver la ganancia según el número de pasajeros.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted">
              {equilibrio
                ? `Con ${equilibrio} pasajeros o más la salida empieza a dar ganancia.`
                : "Ni con el cupo lleno hay ganancia con este precio y estos costos: súbele el precio o baja los costos."}{" "}
              &quot;Ganancia&quot; es tu cargo por servicio, antes del ITBIS y de impuestos sobre la renta.
            </p>
            <table className="mt-4 w-full text-left text-sm">
              <caption className="sr-only">Ganancia de la salida según los pasajeros</caption>
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr><th className="py-2 pr-4">Escenario</th><th className="pr-4">Pasajeros</th><th className="pr-4">Ingreso</th><th className="pr-4">Costo</th><th className="pr-4">Ganancia</th><th>Por persona</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {escenarios.map((e) => (
                  <tr key={e.etiqueta}>
                    <td className="py-2 pr-4 font-semibold">{e.etiqueta}</td>
                    <td className="pr-4">{e.pax}</td>
                    <td className="pr-4">{dinero(e.eco!.revenueCents)}</td>
                    <td className="pr-4">{dinero(e.eco!.costCents)}</td>
                    <td className={`pr-4 font-bold ${e.eco!.negativeMargin ? "text-bad" : "text-ok"}`}>
                      {e.eco!.negativeMargin ? "Pierde dinero" : dinero(e.eco!.serviceFeeCents)}
                    </td>
                    <td>{e.eco!.negativeMargin ? "—" : dinero(e.eco!.profitPerPaxCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted">
              Cada reserva se registra con un costo estimado de {dinero(costPerPax(items, salida.min_passengers))} por persona (repartiendo los costos de grupo entre el mínimo de pasajeros).
            </p>
          </>
        )}
      </section>

      {/* Costos */}
      <section aria-labelledby="t-costos" className="mt-6 rounded-[var(--radius-card)] border border-line bg-paper p-6 shadow-[var(--shadow-lift)]">
        <h2 id="t-costos" className="font-display text-xl font-semibold">Costos por componente</h2>
        {costos.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Todavía no hay costos. Agrega el hotel, el guía, las entradas, el transporte…</p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <caption className="sr-only">Costos de la salida</caption>
            <thead className="text-xs uppercase tracking-wide text-muted">
              <tr><th className="py-2 pr-4">Concepto</th><th className="pr-4">Proveedor</th><th className="pr-4">Monto</th><th className="pr-4">Base</th><th className="pr-4">En {tour.currency}</th><th><span className="sr-only">Acciones</span></th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {costos.map((c) => (
                <tr key={c.id}>
                  <td className="py-2 pr-4">
                    <strong>{c.description}</strong> <span className="text-xs text-muted">{CATEGORIAS[c.category] ?? c.category}</span>
                  </td>
                  <td className="pr-4">{c.supplier_id ? nombreProveedor.get(c.supplier_id) ?? "—" : "—"}</td>
                  <td className="pr-4">{(c.amount_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} {c.currency}</td>
                  <td className="pr-4">{c.basis === "PER_PERSON" ? "Por persona" : "Por grupo"}</td>
                  <td className="pr-4">{dinero(Math.round(c.amount_cents * c.fx_rate_to_base))}</td>
                  <td>
                    <form action={deleteCostItemAction}>
                      <input type="hidden" name="costId" value={c.id} />
                      <input type="hidden" name="returnTo" value={volver} />
                      <button type="submit" className="text-xs font-semibold text-bad underline">Quitar</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <ActionForm action={addCostItemAction} submitLabel="Agregar costo" variant="quiet" className="mt-6 border-t border-line pt-6">
          <h3 className="mb-4 text-sm font-bold">Nuevo costo</h3>
          <input type="hidden" name="departureId" value={salida.id} />
          <input type="hidden" name="returnTo" value={volver} />
          <div className="grid gap-5 md:grid-cols-3">
            <Field label="Concepto" name="description"><input id="description" name="description" required minLength={2} maxLength={120} className={inputClass} /></Field>
            <Field label="Categoría" name="category">
              <select id="category" name="category" defaultValue="LODGING" className={inputClass}>
                {Object.entries(CATEGORIAS).map(([valor, nombre]) => <option key={valor} value={valor}>{nombre}</option>)}
              </select>
            </Field>
            <Field label="Proveedor (opcional)" name="supplierId">
              <select id="supplierId" name="supplierId" defaultValue="" className={inputClass}>
                <option value="">Sin proveedor</option>
                {proveedores.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Moneda del proveedor" name="currency" hint="USD, DOP, COP, PEN, MXN, EUR…"><input id="currency" name="currency" required maxLength={3} defaultValue={tour.currency} className={`${inputClass} uppercase`} /></Field>
            <Field label="Monto" name="amount" hint="En la moneda del proveedor. Ej. 300,000.00"><input id="amount" name="amount" inputMode="decimal" required className={inputClass} /></Field>
            <Field label="Se paga" name="basis">
              <select id="basis" name="basis" defaultValue="PER_PERSON" className={inputClass}>
                <option value="PER_PERSON">Por persona</option>
                <option value="PER_GROUP">Por grupo (una vez)</option>
              </select>
            </Field>
            <Field label={`Tasa a ${tour.currency}`} name="fxRate" hint={`Solo si la moneda es distinta: cuánto vale 1 de esa moneda en ${tour.currency}. Ej. 0.00025`}>
              <input id="fxRate" name="fxRate" inputMode="decimal" className={inputClass} />
            </Field>
          </div>
        </ActionForm>
      </section>

      {/* Cancelar la salida */}
      {salida.status !== "CANCELLED" && (
        <section aria-labelledby="t-cancelar" className="mt-6 rounded-[var(--radius-card)] border border-bad/40 bg-paper p-6">
          <h2 id="t-cancelar" className="font-display text-xl font-semibold">Cancelar esta salida</h2>
          <p className="mt-1 text-sm text-muted">
            Úsalo si la salida no llega al mínimo o no se puede hacer. Se cancelan <strong>{nAfectadas}</strong> reservas
            {aDevolver > 0 ? <> y quedan <strong>{dinero(aDevolver)}</strong> por devolver (100 % de lo cobrado)</> : <> (ninguna tiene dinero cobrado)</>}.
            Se detienen los planes de apartado y los pagos que esperaban verificación se rechazan. Las devoluciones quedan en{" "}
            <Link href="/panel/reembolsos" className="font-semibold text-sea underline underline-offset-4">Reembolsos</Link> para que las marques cuando transfieras. <strong>No se puede deshacer.</strong>
          </p>
          <ActionForm action={cancelDepartureAction} submitLabel="Cancelar la salida" variant="quiet" className="mt-4 max-w-xl">
            <input type="hidden" name="departureId" value={salida.id} />
            <input type="hidden" name="tourId" value={tour.id} />
            <Field label="Motivo (queda registrado)" name="reason">
              <input id="reason" name="reason" required minLength={3} maxLength={300} className={inputClass} placeholder="Ej. No se llegó al mínimo de pasajeros" />
            </Field>
            <label className="mt-4 flex items-start gap-3 text-sm">
              <input type="checkbox" name="confirm" required className="mt-1 size-4" />
              <span>Entiendo que se cancelan todas las reservas de esta salida y que no se puede deshacer.</span>
            </label>
          </ActionForm>
        </section>
      )}

      {/* Datos de la salida */}
      <section aria-labelledby="t-datos" className="mt-6">
        <h2 id="t-datos" className="font-display text-2xl font-semibold">Datos de la salida</h2>
        <ActionForm action={updateDepartureAction} submitLabel="Guardar cambios" className="mt-4 rounded-[var(--radius-card)] border border-line bg-paper p-6">
          <input type="hidden" name="departureId" value={salida.id} />
          <DepartureFields tourId={tour.id} departure={salida} allowOpen={costos.length > 0} />
        </ActionForm>
      </section>
    </>
  );
}
