import { z } from "zod";
import { EmptyState, Etiqueta, formatDateTime } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { zeroOrMany } from "@/lib/supabase/relations";
import { markRefundDoneAction } from "./actions";

const filaSchema = z.object({
  id: z.string(),
  amount_cents: z.number(),
  currency: z.enum(["USD", "DOP"]),
  status: z.enum(["PENDING", "DONE"]),
  created_at: z.string(),
  done_at: z.string().nullable(),
  note: z.string().nullable(),
  booking: zeroOrMany(z.object({ code: z.string(), customer: zeroOrMany(z.object({ full_name: z.string(), phone_e164: z.string() })) })),
});

const tarjetaSchema = z.object({
  id: z.string(),
  amount_cents: z.number(),
  currency: z.enum(["USD", "DOP"]),
  created_at: z.string(),
  booking: zeroOrMany(z.object({ code: z.string() })),
});

const AVISOS: Record<string, { texto: string; tono: "ok" | "malo" }> = {
  ok: { texto: "Devolución marcada como hecha.", tono: "ok" },
  "error:datos": { texto: "Datos inválidos.", tono: "malo" },
  "error:yahecho": { texto: "Esa devolución ya estaba marcada.", tono: "malo" },
  "error:interno": { texto: "Ocurrió un error. Inténtalo de nuevo.", tono: "malo" },
};

export default async function ReembolsosPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requireAdmin();
  const { ok, error, cancelada, reservas, reembolsos } = await searchParams;
  const aviso = ok ? AVISOS.ok : typeof error === "string" ? AVISOS[`error:${error}`] : undefined;

  const { data, error: errorLectura } = await createAdminClient()
    .from("refunds")
    .select("id, amount_cents, currency, status, created_at, done_at, note, booking:bookings!inner(code, customer:customers!inner(full_name, phone_e164))")
    .order("status", { ascending: false }) // PENDING primero
    .order("created_at", { ascending: false })
    .limit(200);
  if (errorLectura) throw new Error(`No se pudieron cargar los reembolsos: ${errorLectura.message}`);
  const filas = z.array(filaSchema).parse(data ?? []);

  // Cobros con tarjeta que el banco aprobó pero no se pudieron aplicar (p. ej. la salida se canceló mientras el
  // cliente pagaba): también hay que devolverlos o conciliarlos
  const { data: porConciliar, error: errorTarjeta } = await createAdminClient()
    .from("azul_transactions")
    .select("id, amount_cents, currency, created_at, booking:bookings!inner(code)")
    .eq("status", "error")
    .order("created_at", { ascending: false })
    .limit(100);
  if (errorTarjeta) throw new Error(`No se pudieron cargar los cobros con tarjeta: ${errorTarjeta.message}`);
  const tarjetas = z.array(tarjetaSchema).parse(porConciliar ?? []);
  const pendientes = filas.filter((f) => f.status === "PENDING");
  const hechos = filas.filter((f) => f.status === "DONE");

  // Los totales se separan por moneda: nunca se suman dólares con pesos
  const totales = new Map<string, number>();
  for (const f of pendientes) totales.set(f.currency, (totales.get(f.currency) ?? 0) + f.amount_cents);

  return (
    <>
      <h1 className="font-display text-4xl font-semibold tracking-tight">Reembolsos</h1>
      <p className="mt-2 text-muted">Dinero que hay que devolver a clientes por salidas canceladas. Transfiere desde el banco y luego márcalo aquí.</p>

      {cancelada === "1" && (
        <p role="status" className="mt-6 rounded-lg border border-ok/40 bg-ok/10 px-4 py-3 text-sm font-medium text-ok">
          Salida cancelada: {Number(reservas) || 0} reservas canceladas y {Number(reembolsos) || 0} reembolsos por hacer.
        </p>
      )}
      {aviso && (
        <p role="status" className={`mt-6 rounded-lg border px-4 py-3 text-sm font-medium ${aviso.tono === "ok" ? "border-ok/40 bg-ok/10 text-ok" : "border-bad/40 bg-bad/10 text-bad"}`}>
          {aviso.texto}
        </p>
      )}

      <section aria-labelledby="r-pend" className="mt-8">
        <h2 id="r-pend" className="font-display text-2xl font-semibold">
          Por devolver {totales.size > 0 && <span className="text-base font-normal text-muted">· {[...totales].map(([m, c]) => formatMoney(c, m as "USD" | "DOP")).join(" + ")}</span>}
        </h2>
        {pendientes.length === 0 ? (
          <div className="mt-4"><EmptyState>No hay devoluciones pendientes.</EmptyState></div>
        ) : (
          <ul className="mt-4 space-y-4">
            {pendientes.map((f) => {
              const reserva = f.booking[0];
              const cliente = reserva?.customer[0];
              return (
                <li key={f.id} className="rounded-[var(--radius-card)] border border-line bg-paper p-6 shadow-[var(--shadow-lift)]">
                  <p className="font-display text-3xl font-semibold">{formatMoney(f.amount_cents, f.currency)}</p>
                  <p className="mt-1 text-sm text-muted">
                    {reserva?.code} · {cliente?.full_name} · {cliente?.phone_e164} · {formatDateTime(f.created_at)}
                  </p>
                  <form action={markRefundDoneAction} className="mt-4 flex flex-wrap items-end gap-3">
                    <input type="hidden" name="refundId" value={f.id} />
                    <div>
                      <label htmlFor={`nota-${f.id}`} className="block text-xs font-semibold text-muted">Nota (opcional): referencia de la transferencia</label>
                      <input id={`nota-${f.id}`} name="note" maxLength={300} className="mt-1 w-72 rounded-lg border border-line bg-sand px-3 py-2 text-sm" />
                    </div>
                    <button type="submit" className="rounded-full bg-ok px-6 py-3 text-sm font-bold text-white transition-transform hover:-translate-y-0.5 active:translate-y-0">
                      Ya devolví el dinero
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {tarjetas.length > 0 && (
        <section aria-labelledby="r-tarjeta" className="mt-10">
          <h2 id="r-tarjeta" className="font-display text-2xl font-semibold">Cobros con tarjeta por conciliar</h2>
          <p className="mt-1 text-sm text-muted">
            Azul respondió con un cobro que no se pudo aplicar a la reserva (reserva cerrada, monto distinto…). Revisa en el portal de Azul si el dinero entró y devuélvelo o aplícalo a mano.
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            {tarjetas.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-bad/40 bg-paper px-4 py-3">
                <span>{t.booking[0]?.code} · {formatMoney(t.amount_cents, t.currency)} · {formatDateTime(t.created_at)}</span>
                <Etiqueta tono="malo">Por conciliar</Etiqueta>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hechos.length > 0 && (
        <section aria-labelledby="r-hechos" className="mt-10">
          <h2 id="r-hechos" className="font-display text-2xl font-semibold">Ya devueltos</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {hechos.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-paper px-4 py-3">
                <span>{f.booking[0]?.code} · {formatMoney(f.amount_cents, f.currency)}{f.note ? ` · ${f.note}` : ""}</span>
                <Etiqueta tono="ok">Devuelto {f.done_at ? formatDateTime(f.done_at) : ""}</Etiqueta>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
