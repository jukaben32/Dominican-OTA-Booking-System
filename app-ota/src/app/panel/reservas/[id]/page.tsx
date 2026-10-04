import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm, Field, inputClass } from "@/components/action-form";
import { Etiqueta, formatDateTime, formatDay, type Tono } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getOnlineEnv } from "@/lib/env";
import { deriveAccessToken } from "@/lib/online/access-token";
import { formatMoney } from "@/lib/money";
import { passengerLabel } from "@/lib/tours/passengers";
import { todayInSantoDomingo, diffDays } from "@/lib/dates";
import { computeRefund, describePolicy, refundPercentFor, rulesFromSnapshot } from "@/lib/tours/cancellation";
import { getDeparture } from "@/lib/supabase/tours-repo";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BOOKING_DETAIL_SELECT, bookingDetailSchema } from "@/lib/supabase/booking-detail";
import { createPlanAction, enableCustomerLinkAction, issueTicketAction, registerManualPaymentAction } from "./actions";

const NOMBRE_ESTADO: Record<string, string> = {
  QUOTED: "Cotizada", ON_HOLD: "En espera", PENDING_PAYMENT: "Por pagar", PARTIALLY_PAID: "Pago parcial",
  PAID: "Pagada", TICKETED: "Emitida", CANCELLED: "Cancelada", EXPIRED: "Vencida", REFUNDED: "Reembolsada",
};
const TONO_ESTADO: Record<string, Tono> = {
  PAID: "ok", TICKETED: "ok", PARTIALLY_PAID: "aviso", PENDING_PAYMENT: "aviso", ON_HOLD: "aviso", CANCELLED: "malo", EXPIRED: "malo",
};
const NOMBRE_PRODUCTO: Record<string, string> = {
  FLIGHT: "Boleto aéreo", GROUP_SEAT: "Cupo de grupo", PACKAGE: "Paquete", HOTEL: "Hotel", INSURANCE: "Seguro", TRANSFER: "Traslado",
};
const NOMBRE_CUOTA: Record<string, string> = { PENDING: "Pendiente", PAID: "Pagada", PARTIAL: "Parcial", OVERDUE: "Vencida", WAIVED: "Perdonada" };
const TONO_CUOTA: Record<string, Tono> = { PAID: "ok", PARTIAL: "aviso", OVERDUE: "malo", WAIVED: "neutro", PENDING: "neutro" };
const NOMBRE_PAGO: Record<string, string> = { PENDING_VERIFICATION: "Por verificar", APPROVED: "Aplicado", REJECTED: "Rechazado", REFUNDED: "Reembolsado" };
const NOMBRE_METODO: Record<string, string> = { CARD: "Tarjeta", TRANSFER: "Transferencia", CASH: "Efectivo" };
const NOMBRE_FRECUENCIA: Record<string, string> = { WEEKLY: "Semanal", BIWEEKLY: "Quincenal", MONTHLY: "Mensual" };

const ABIERTAS_PARA_PAGO = new Set(["QUOTED", "ON_HOLD", "PENDING_PAYMENT", "PARTIALLY_PAID"]);
const ABIERTAS_PARA_PLAN = new Set(["QUOTED", "ON_HOLD", "PENDING_PAYMENT"]);

export default async function ReservaPage({ params }: { params: Promise<{ id: string }> }) {
  const usuario = await requireStaff();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const db = await createClient();
  const { data, error } = await db
    .from("bookings")
    .select(BOOKING_DETAIL_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`No se pudo cargar la reserva: ${error.message}`);
  if (!data) notFound();

  const r = bookingDetailSchema.parse(data);
  // Costo del proveedor y ganancia: SOLO para el administrador, leídos por el servidor (el agente no tiene permiso)
  let margen: { costo: number; cargo: number } | null = null;
  if (usuario.role === "ADMIN") {
    const { data: m } = await createAdminClient().from("bookings").select("supplier_cost_cents, service_fee_cents").eq("id", r.id).maybeSingle();
    if (m) margen = { costo: Number(m.supplier_cost_cents), cargo: Number(m.service_fee_cents) };
  }
  const plan = r.payment_plans[0];
  const cuotas = plan ? [...plan.installments].sort((a, b) => a.sequence - b.sequence) : [];
  const pagos = [...r.payments].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const falta = r.total_cents - r.paid_cents;
  const porcentaje = Math.min(100, Math.round((r.paid_cents / r.total_cents) * 100));
  const dinero = (c: number) => formatMoney(c, r.currency);
  const puedeAbonar = ABIERTAS_PARA_PAGO.has(r.status) && falta > 0;
  const puedePlan = ABIERTAS_PARA_PLAN.has(r.status) && r.paid_cents === 0 && !plan;
  const tarifaGarantizada = r.price_guaranteed || r.group_block_id !== null;
  // Política con la que se vendió (copia guardada en la reserva) y cuánto se reembolsaría si cancelara HOY
  const politica = rulesFromSnapshot(r.cancellation_snapshot);
  const salidaTour = r.departure_id ? await getDeparture(db, r.departure_id) : null;
  const diasParaSalir = salidaTour ? diffDays(todayInSantoDomingo(), salidaTour.departs_on) : null;
  const porcentajeReembolso = politica && diasParaSalir !== null ? refundPercentFor(politica.rules, diasParaSalir) : null;
  // Enlace privado del cliente (solo reservas de tour). Se ve únicamente si ya fue activado por un agente.
  let enlaceCliente: string | null = null;
  let puedeActivarEnlace = false;
  if (r.departure_id && r.source === "AGENT") {
    const { data: l } = await db.from("bookings").select("form_token, has_customer_link").eq("id", r.id).maybeSingle();
    if (l?.has_customer_link && l.form_token) {
      const sitio = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
      enlaceCliente = `${sitio}/mi-reserva/${deriveAccessToken(String(l.form_token), getOnlineEnv().ONLINE_LINK_SECRET).token}`;
    } else {
      puedeActivarEnlace = Boolean(l?.form_token) && ["QUOTED", "ON_HOLD", "PENDING_PAYMENT", "PARTIALLY_PAID", "PAID", "TICKETED"].includes(r.status);
    }
  }
  const tokenPago = crypto.randomUUID(); // un token por carga de la página: un doble clic no duplica el pago

  return (
    <>
      <Link href="/panel/reservas" className="text-sm font-semibold text-sea underline underline-offset-4">
        ← Volver a reservas
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <h1 className="font-display text-4xl font-semibold tracking-tight">{r.code}</h1>
        <Etiqueta tono={TONO_ESTADO[r.status] ?? "neutro"}>{NOMBRE_ESTADO[r.status] ?? r.status}</Etiqueta>
        {r.source === "ONLINE" && <Etiqueta tono="aviso">Reserva en línea</Etiqueta>}
        {r.source === "ONLINE" && r.status === "PENDING_PAYMENT" && r.hold_expires_at && (
          <span className="text-sm text-muted">cupo guardado hasta {formatDateTime(r.hold_expires_at)}</span>
        )}
        {r.requires_review && <Etiqueta tono="malo">Revisar antes de emitir</Etiqueta>}
      </div>
      <p className="mt-2 text-muted">
        {NOMBRE_PRODUCTO[r.product_type] ?? r.product_type} · {r.customer.full_name} · {r.customer.phone_e164}
        {!r.customer.whatsapp_opt_in_at && " · sin permiso de WhatsApp"}
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        {/* Dinero */}
        <section aria-labelledby="t-dinero" className="rounded-[var(--radius-card)] border border-line bg-paper p-6 shadow-[var(--shadow-lift)]">
          <h2 id="t-dinero" className="font-display text-xl font-semibold">Precio y cobro</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Precio sin ITBIS</dt><dd>{dinero(r.total_cents - r.itbis_cents)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">ITBIS incluido</dt><dd>{dinero(r.itbis_cents)}</dd></div>
            {margen && (
              <>
                <div className="flex justify-between text-xs"><dt className="text-muted">Costo del proveedor (confidencial)</dt><dd>{dinero(margen.costo)}</dd></div>
                <div className="flex justify-between text-xs"><dt className="text-muted">Cargo / ganancia de la agencia (confidencial)</dt><dd>{dinero(margen.cargo)}</dd></div>
              </>
            )}
            <div className="flex justify-between border-t border-line pt-2 text-base font-bold"><dt>Total</dt><dd>{dinero(r.total_cents)}</dd></div>
          </dl>
          <p className="mt-5 text-sm">
            <span className="font-bold">{dinero(r.paid_cents)}</span>
            <span className="text-muted"> cobrado · falta {dinero(falta)}</span>
          </p>
          <div role="progressbar" aria-label={`Cobrado ${porcentaje} %`} aria-valuenow={porcentaje} aria-valuemin={0} aria-valuemax={100} className="mt-2 h-2 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-coral" style={{ width: `${porcentaje}%` }} />
          </div>
          <p className="mt-4 text-xs text-muted">
            {tarifaGarantizada ? "Tarifa garantizada por el proveedor." : "Precio no garantizado hasta emitir."}
            {r.supplier_deadline && ` Vence con el proveedor: ${formatDateTime(r.supplier_deadline)}.`}
            {r.pnr && ` Localizador: ${r.pnr}.`}
          </p>
          {r.requires_review && (
            <p className="mt-3 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs font-medium text-bad">
              Señales de fraude: {r.review_reasons.join(", ")}. Verifica antes de emitir.
            </p>
          )}
        </section>

        {/* Viaje */}
        <section aria-labelledby="t-viaje" className="rounded-[var(--radius-card)] border border-line bg-paper p-6 shadow-[var(--shadow-lift)]">
          <h2 id="t-viaje" className="font-display text-xl font-semibold">Viaje</h2>
          <h3 className="mt-4 text-sm font-semibold text-muted">Pasajeros</h3>
          <ul className="mt-1 text-sm">
            {r.passengers.map((p, i) => <li key={i}>{passengerLabel(p.full_name, p.passenger_type, p.room_type)}</li>)}
          </ul>
          <h3 className="mt-4 text-sm font-semibold text-muted">Vuelos</h3>
          {r.flight_segments.length === 0 ? (
            <p className="mt-1 text-sm text-muted">Sin tramo registrado.</p>
          ) : (
            <ul className="mt-1 text-sm">
              {r.flight_segments.map((s, i) => (
                <li key={i}>{s.airline}: {s.origin_iata} → {s.dest_iata} · {formatDateTime(s.departs_at)}</li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Documentos y política de cancelación */}
      <section aria-labelledby="t-docs" className="mt-6 rounded-[var(--radius-card)] border border-line bg-paper p-6 shadow-[var(--shadow-lift)]">
        <h2 id="t-docs" className="font-display text-xl font-semibold">Documentos para el cliente</h2>
        <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold">
          <a href={`/panel/reservas/${r.id}/documento?tipo=cotizacion`} target="_blank" rel="noopener noreferrer" className="rounded-full border border-line px-5 py-2.5 hover:bg-sand">
            Descargar cotización (PDF)
          </a>
          {(r.status === "PAID" || r.status === "TICKETED") ? (
            <a href={`/panel/reservas/${r.id}/documento?tipo=voucher`} target="_blank" rel="noopener noreferrer" className="rounded-full bg-ink px-5 py-2.5 text-sand">
              Descargar voucher (PDF)
            </a>
          ) : (
            <span className="rounded-full border border-dashed border-line px-5 py-2.5 text-muted">El voucher se habilita al pagar el 100 %</span>
          )}
        </div>
        {politica && (
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="text-sm font-bold">Política de cancelación ({politica.name})</h3>
            <ul className="mt-1 list-disc pl-5 text-sm text-muted">{describePolicy(politica.rules).map((l) => <li key={l}>{l}</li>)}</ul>
            {porcentajeReembolso !== null && (
              <p className="mt-3 text-sm">
                Si cancelara <strong>hoy</strong> ({diasParaSalir} días antes de la salida): reembolso del <strong>{porcentajeReembolso} %</strong>
                {r.paid_cents > 0 && <> de lo pagado = <strong>{dinero(computeRefund(r.paid_cents, porcentajeReembolso))}</strong></>}.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Plan de apartado */}
      <section aria-labelledby="t-plan" className="mt-6 rounded-[var(--radius-card)] border border-line bg-paper p-6 shadow-[var(--shadow-lift)]">
        <h2 id="t-plan" className="font-display text-xl font-semibold">Plan de apartado (sin intereses)</h2>
        {plan ? (
          <>
            <p className="mt-1 text-sm text-muted">
              {NOMBRE_FRECUENCIA[plan.frequency] ?? plan.frequency} · la última cuota vence el {formatDay(plan.final_due_date)} · estado del plan: {plan.status}
            </p>
            <table className="mt-4 w-full text-left text-sm">
              <caption className="sr-only">Cuotas del plan de pago</caption>
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr><th className="py-2 pr-4">Cuota</th><th className="pr-4">Vence</th><th className="pr-4">Monto</th><th className="pr-4">Pagado</th><th>Estado</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {cuotas.map((c) => (
                  <tr key={c.sequence}>
                    <td className="py-2 pr-4">{c.kind === "DOWN_PAYMENT" ? "Abono inicial" : `Cuota ${c.sequence}`}</td>
                    <td className="pr-4">{formatDay(c.due_date)}</td>
                    <td className="pr-4">{dinero(c.amount_cents)}</td>
                    <td className="pr-4">{dinero(c.paid_cents)}</td>
                    <td><Etiqueta tono={TONO_CUOTA[c.status] ?? "neutro"}>{NOMBRE_CUOTA[c.status] ?? c.status}</Etiqueta></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : puedePlan ? (
          tarifaGarantizada && r.supplier_deadline ? (
            <ActionForm action={createPlanAction} submitLabel="Crear plan" className="mt-3 max-w-2xl">
              <input type="hidden" name="bookingId" value={r.id} />
              <p className="mb-4 text-sm text-muted">
                Las cuotas suman exactamente el total (sin recargos). La última vence 7 días antes del vencimiento del proveedor.
              </p>
              <div className="grid gap-5 md:grid-cols-3">
                <Field label="Abono inicial (%)" name="downPaymentPercent" hint="Entre 20 y 50">
                  <input id="downPaymentPercent" name="downPaymentPercent" type="number" min={20} max={50} step={1} defaultValue={25} required className={inputClass} />
                </Field>
                <Field label="Número de cuotas" name="installmentCount" hint="Sin contar el abono. De 1 a 12">
                  <input id="installmentCount" name="installmentCount" type="number" min={1} max={12} step={1} defaultValue={4} required className={inputClass} />
                </Field>
                <Field label="Frecuencia" name="frequency">
                  <select id="frequency" name="frequency" defaultValue="BIWEEKLY" className={inputClass}>
                    <option value="WEEKLY">Semanal</option>
                    <option value="BIWEEKLY">Quincenal</option>
                    <option value="MONTHLY">Mensual</option>
                  </select>
                </Field>
              </div>
            </ActionForm>
          ) : (
            <p className="mt-2 text-sm text-muted">
              No se puede ofrecer apartado: {!tarifaGarantizada ? "la tarifa no está garantizada por el proveedor" : "falta el vencimiento del proveedor"}.
              Una tarifa individual puede subir mientras el cliente paga; para estos casos, pago completo.
            </p>
          )
        ) : (
          <p className="mt-2 text-sm text-muted">Esta reserva no tiene plan de apartado.</p>
        )}
      </section>

      {/* Pagos */}
      <section aria-labelledby="t-pagos" className="mt-6 rounded-[var(--radius-card)] border border-line bg-paper p-6 shadow-[var(--shadow-lift)]">
        <h2 id="t-pagos" className="font-display text-xl font-semibold">Pagos</h2>
        {pagos.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Todavía no hay pagos registrados.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line text-sm">
            {pagos.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong>{dinero(p.amount_cents)}</strong> · {NOMBRE_METODO[p.method] ?? p.method}
                  {p.bank_reference && ` · ref. ${p.bank_reference}`} · {formatDateTime(p.created_at)}
                  {p.unapplied_cents > 0 && <span className="text-bad"> · sobrante {dinero(p.unapplied_cents)} (devolver o conciliar)</span>}
                </span>
                <Etiqueta tono={p.status === "APPROVED" ? "ok" : p.status === "REJECTED" ? "malo" : "aviso"}>{NOMBRE_PAGO[p.status] ?? p.status}</Etiqueta>
              </li>
            ))}
          </ul>
        )}

        {puedeAbonar && (
          <ActionForm action={registerManualPaymentAction} submitLabel="Registrar pago" variant="quiet" className="mt-6 max-w-2xl border-t border-line pt-6">
            <h3 className="mb-1 text-sm font-bold">Registrar transferencia o efectivo</h3>
            <p className="mb-4 text-sm text-muted">
              Queda <strong>por verificar</strong>: se aplica a la reserva cuando lo apruebes en &quot;Pagos por verificar&quot;, tras confirmar el dinero en el banco.
            </p>
            <input type="hidden" name="bookingId" value={r.id} />
            <input type="hidden" name="formToken" value={tokenPago} />
            <div className="grid gap-5 md:grid-cols-3">
              <Field label={`Monto (${r.currency})`} name="amount" hint={`Falta ${dinero(falta)}`}>
                <input id="amount" name="amount" inputMode="decimal" required placeholder="0.00" className={inputClass} />
              </Field>
              <Field label="Método" name="method">
                <select id="method" name="method" defaultValue="TRANSFER" className={inputClass}>
                  <option value="TRANSFER">Transferencia</option>
                  <option value="CASH">Efectivo</option>
                </select>
              </Field>
              <Field label="Referencia bancaria" name="bankReference" hint="No se puede repetir en otro pago">
                <input id="bankReference" name="bankReference" maxLength={60} autoComplete="off" className={inputClass} />
              </Field>
            </div>
            <Field label="Comprobante (foto o PDF)" name="proof" hint="JPG, PNG, WebP o PDF, hasta 5 MB. Una transferencia necesita comprobante o referencia." className="mt-5">
              <input id="proof" name="proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className={inputClass} />
            </Field>
          </ActionForm>
        )}
      </section>

      {/* Enlace del cliente */}
      {(enlaceCliente || puedeActivarEnlace) && (
        <section aria-labelledby="t-enlace" className="mt-6 rounded-[var(--radius-card)] border border-line bg-paper p-6 shadow-[var(--shadow-lift)]">
          <h2 id="t-enlace" className="font-display text-xl font-semibold">Enlace del cliente</h2>
          {enlaceCliente ? (
            <>
              <p className="mt-1 text-sm text-muted">
                Envíaselo al cliente: ahí ve su reserva, descarga su cotización y voucher, paga con tarjeta o sube su comprobante. Es su acceso personal: quien tenga el enlace ve la reserva.
              </p>
              <input readOnly value={enlaceCliente} aria-label="Enlace privado del cliente" className="mt-3 w-full rounded-lg border border-line bg-sand px-3 py-2 text-sm" />
            </>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted">Genera un enlace privado para que el cliente vea su reserva, pague con tarjeta o suba su comprobante.</p>
              <form action={enableCustomerLinkAction} className="mt-3">
                <input type="hidden" name="bookingId" value={r.id} />
                <button type="submit" className="rounded-full border border-line bg-paper px-5 py-2.5 text-sm font-bold hover:bg-sand">Generar enlace del cliente</button>
              </form>
            </>
          )}
        </section>
      )}

      {/* Emisión */}
      {r.status === "PAID" && (
        <section aria-labelledby="t-emitir" className="mt-6 rounded-[var(--radius-card)] border border-ok/40 bg-paper p-6 shadow-[var(--shadow-lift)]">
          <h2 id="t-emitir" className="font-display text-xl font-semibold">Emitir boleto</h2>
          <p className="mt-1 text-sm text-muted">
            Pagada al 100 %. Emite el boleto con el consolidador y escribe aquí el localizador.
            {r.requires_review && " ⚠️ Esta reserva tiene señales de fraude: verifícala antes."}
          </p>
          <ActionForm action={issueTicketAction} submitLabel="Marcar como emitida" className="mt-3 max-w-sm">
            <input type="hidden" name="bookingId" value={r.id} />
            <Field label="Localizador (PNR)" name="pnr" hint="5 a 8 letras o números">
              <input id="pnr" name="pnr" required minLength={5} maxLength={8} autoComplete="off" className={`${inputClass} uppercase`} />
            </Field>
          </ActionForm>
        </section>
      )}
    </>
  );
}
