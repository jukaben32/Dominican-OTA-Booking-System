import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Field, inputClass } from "@/components/action-form";
import { CardPayButton } from "@/components/card-pay-button";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { Etiqueta, formatDateTime, formatDay } from "@/components/ui";
import { whatsappLink } from "@/lib/company";
import { getOnlineEnv } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import { getAzulSetup } from "@/lib/payments/azul-config";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOnlineBookingByToken } from "@/lib/supabase/online-repo";
import { passengerLabel } from "@/lib/tours/passengers";
import { submitOnlineProofAction } from "./actions";
import { startCardPaymentAction } from "./card-actions";

// Es una página PERSONAL: sin copia guardada, sin buscadores y sin enviar el enlace a otros sitios
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Mi reserva — Dominican OTA Booking",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const ESTADO: Record<string, { texto: string; tono: "ok" | "malo" | "neutro" }> = {
  QUOTED: { texto: "Cotizada, falta el pago", tono: "neutro" },
  ON_HOLD: { texto: "En espera, falta el pago", tono: "neutro" },
  PENDING_PAYMENT: { texto: "Cupo guardado, falta el pago", tono: "neutro" },
  PARTIALLY_PAID: { texto: "Pago parcial recibido", tono: "neutro" },
  PAID: { texto: "Pagada", tono: "ok" },
  TICKETED: { texto: "Confirmada", tono: "ok" },
  EXPIRED: { texto: "Venció sin pago", tono: "malo" },
  CANCELLED: { texto: "Cancelada", tono: "malo" },
  REFUNDED: { texto: "Reembolsada", tono: "malo" },
};
const AVISO_TARJETA: Record<string, { texto: string; tono: "ok" | "malo" }> = {
  aprobado: { texto: "¡Pago con tarjeta aprobado! En unos momentos verás tu reserva actualizada.", tono: "ok" },
  declinado: { texto: "El banco no aprobó la tarjeta y no se te cobró nada. Puedes intentarlo con otra o pagar por transferencia.", tono: "malo" },
  cancelado: { texto: "Cancelaste el pago con tarjeta. No se te cobró nada.", tono: "malo" },
  revision: { texto: "Recibimos la respuesta del banco y un asesor la está verificando. No vuelvas a pagar: te escribiremos.", tono: "ok" },
  error: { texto: "No pudimos confirmar el pago con tarjeta. Si te cobraron, un asesor lo revisará: escríbenos.", tono: "malo" },
};
const PAGO: Record<string, string> = {
  PENDING_VERIFICATION: "En verificación",
  APPROVED: "Confirmado",
  REJECTED: "No pudimos confirmarlo",
  REFUNDED: "Reembolsado",
};

export default async function MiReservaPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { token } = await params;
  const { enviado, pago } = await searchParams;
  const reserva = await getOnlineBookingByToken(createAdminClient(), token);
  if (!reserva) notFound();

  const falta = reserva.total_cents - reserva.paid_cents;
  const vencida = reserva.status === "PENDING_PAYMENT" && reserva.hold_expires_at !== null && new Date(reserva.hold_expires_at) < new Date();
  const puedePagar = ["QUOTED", "ON_HOLD", "PENDING_PAYMENT", "PARTIALLY_PAID"].includes(reserva.status) && !vencida && falta > 0;
  const estado = ESTADO[reserva.status] ?? { texto: reserva.status, tono: "neutro" as const };
  const banco = getOnlineEnv().BANK_TRANSFER_INSTRUCTIONS;
  const ayuda = whatsappLink(`Hola, necesito ayuda con mi reserva ${reserva.code}`);
  const formToken = crypto.randomUUID();
  // La tarjeta se ofrece solo si Azul está configurado y acepta la moneda de esta reserva
  const aceptaTarjeta = Boolean(getAzulSetup()?.config.currencyCodes[reserva.currency]);
  const avisoPago = typeof pago === "string" ? AVISO_TARJETA[pago] : undefined;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-5 py-12">
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-coral-deep">Reserva {reserva.code}</p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">{reserva.tourTitle}</h1>
        <p className="mt-2 text-muted">
          {reserva.destination} · salida {formatDay(reserva.departsOn)} → {formatDay(reserva.returnsOn)}
        </p>
        <div className="mt-4"><Etiqueta tono={estado.tono}>{estado.texto}</Etiqueta></div>

        {avisoPago && (
          <p role="status" className={`mt-6 rounded-lg border px-4 py-3 text-sm font-medium ${avisoPago.tono === "ok" ? "border-ok/40 bg-ok/10 text-ok" : "border-bad/40 bg-bad/10 text-bad"}`}>
            {avisoPago.texto}
          </p>
        )}

        {enviado === "1" && (
          <p role="status" className="mt-6 rounded-lg border border-ok/40 bg-ok/10 px-4 py-3 text-sm font-medium text-ok">
            ¡Recibimos tu aviso de pago! Un asesor lo verifica en el banco y te confirma. No hace falta que envíes nada más.
          </p>
        )}

        <section aria-labelledby="m-res" className="mt-8 rounded-[var(--radius-card)] border border-line bg-paper p-6 shadow-[var(--shadow-lift)]">
          <h2 id="m-res" className="font-display text-xl font-semibold">Tu reserva</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {reserva.passengers.map((p, i) => <li key={i}>{passengerLabel(p.full_name, p.passenger_type, p.room_type)}</li>)}
          </ul>
          <dl className="mt-5 grid grid-cols-3 gap-4 border-t border-line pt-4 text-sm">
            <div><dt className="text-muted">Total</dt><dd className="font-display text-xl font-semibold">{formatMoney(reserva.total_cents, reserva.currency)}</dd></div>
            <div><dt className="text-muted">Pagado</dt><dd className="font-display text-xl font-semibold">{formatMoney(reserva.paid_cents, reserva.currency)}</dd></div>
            <div><dt className="text-muted">Falta</dt><dd className="font-display text-xl font-semibold">{formatMoney(falta, reserva.currency)}</dd></div>
          </dl>
          {reserva.status === "PENDING_PAYMENT" && reserva.hold_expires_at && (
            <p className={`mt-4 text-sm ${vencida ? "font-semibold text-bad" : "text-muted"}`}>
              {vencida ? "El plazo para pagar venció." : <>Tu cupo está guardado hasta el <strong>{formatDateTime(reserva.hold_expires_at)}</strong>.</>}
            </p>
          )}
        </section>

        <section aria-labelledby="m-docs" className="mt-6">
          <h2 id="m-docs" className="font-display text-xl font-semibold">Documentos</h2>
          <ul className="mt-3 flex flex-wrap gap-4 text-sm font-semibold">
            <li><a href={`/mi-reserva/${token}/documento?tipo=cotizacion`} className="text-sea underline underline-offset-4">Descargar cotización (PDF)</a></li>
            {(reserva.status === "PAID" || reserva.status === "TICKETED") ? (
              <li><a href={`/mi-reserva/${token}/documento?tipo=voucher`} className="text-sea underline underline-offset-4">Descargar voucher (PDF)</a></li>
            ) : (
              <li className="font-normal text-muted">El voucher estará disponible cuando la reserva esté pagada al 100 %.</li>
            )}
          </ul>
        </section>

        {reserva.payments.length > 0 && (
          <section aria-labelledby="m-pagos" className="mt-6">
            <h2 id="m-pagos" className="font-display text-xl font-semibold">Tus pagos</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {reserva.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap justify-between gap-2 rounded-lg border border-line bg-paper px-4 py-3">
                  <span>{formatMoney(p.amount_cents, reserva.currency)} · {formatDateTime(p.created_at)}</span>
                  <span className="font-semibold">
                    {PAGO[p.status] ?? p.status}
                    {p.status === "REJECTED" && p.rejection_reason ? `: ${p.rejection_reason}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {puedePagar && (
          <section aria-labelledby="m-pagar" className="mt-8">
            <h2 id="m-pagar" className="font-display text-2xl font-semibold">Cómo pagar</h2>
            {aceptaTarjeta && (
              <div className="mt-4 rounded-lg border border-line bg-paper p-4">
                <p className="text-sm font-semibold">Con tarjeta</p>
                <p className="mb-3 mt-1 text-sm text-muted">Pagas lo que falta ({formatMoney(falta, reserva.currency)}) en la página segura del banco. No guardamos los datos de tu tarjeta.</p>
                <CardPayButton action={startCardPaymentAction} token={token} />
              </div>
            )}
            <p className="mt-5 text-sm font-semibold">{aceptaTarjeta ? "O por transferencia" : "Por transferencia"}</p>
            <p className="mt-2 text-sm text-muted">
              Haz una transferencia por el monto que quieras abonar (el total es {formatMoney(falta, reserva.currency)}) y avísanos aquí con el comprobante.
            </p>
            {banco ? (
              <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-line bg-sand p-4 font-sans text-sm">{banco}</pre>
            ) : (
              <p className="mt-3 rounded-lg border border-line bg-sand p-4 text-sm">Un asesor te enviará los datos para la transferencia por WhatsApp.</p>
            )}

            <ActionForm action={submitOnlineProofAction} submitLabel="Ya transferí: avisar" variant="quiet" className="mt-6">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="formToken" value={formToken} />
              <div className="grid gap-5 md:grid-cols-2">
                <Field label={`Monto transferido (${reserva.currency})`} name="amount" hint={`Falta ${formatMoney(falta, reserva.currency)}`}>
                  <input id="amount" name="amount" inputMode="decimal" required placeholder="0.00" className={inputClass} />
                </Field>
                <Field label="Referencia de la transferencia" name="bankReference" hint="Número de confirmación del banco">
                  <input id="bankReference" name="bankReference" maxLength={60} autoComplete="off" className={inputClass} />
                </Field>
              </div>
              <Field label="Comprobante (foto o PDF)" name="proof" hint="JPG, PNG, WebP o PDF, hasta 5 MB. Adjunta el comprobante o escribe la referencia." className="mt-5">
                <input id="proof" name="proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className={inputClass} />
              </Field>
            </ActionForm>
          </section>
        )}

        {(vencida || reserva.status === "EXPIRED") && (
          <p className="mt-8 text-sm">
            Si todavía quieres este viaje, <Link href={`/tours/${reserva.tourSlug}`} className="font-semibold text-sea underline underline-offset-4">haz una nueva reserva</Link>
            {ayuda && <> o <a href={ayuda} className="font-semibold text-sea underline underline-offset-4">escríbenos por WhatsApp</a></>}.
          </p>
        )}

        <p className="mt-10 text-xs leading-relaxed text-muted">
          Guarda este enlace: es tu acceso personal a la reserva. No lo compartas.
          {ayuda && <> ¿Dudas? <a href={ayuda} className="font-semibold text-sea underline underline-offset-4">Escríbenos por WhatsApp</a>.</>}
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
