import { z } from "zod";
import { EmptyState } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { summarizeSales, type Bucket } from "@/lib/reports/sales";
import { createAdminClient } from "@/lib/supabase/admin";

const LIMITE = 5000;

const filaSchema = z.object({
  created_at: z.string(),
  status: z.string(),
  currency: z.enum(["USD", "DOP"]),
  source: z.enum(["AGENT", "ONLINE"]),
  total_cents: z.number(),
  paid_cents: z.number(),
  service_fee_cents: z.number(),
});

const NOMBRE_MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const mesLegible = (m: string) => `${NOMBRE_MES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

export default async function ReportesPage() {
  await requireAdmin(); // incluye ganancias: SOLO administradores

  const { data, error } = await createAdminClient()
    .from("bookings")
    .select("created_at, status, currency, source, total_cents, paid_cents, service_fee_cents")
    .order("created_at", { ascending: false })
    .limit(LIMITE);
  if (error) throw new Error(`No se pudieron cargar las ventas: ${error.message}`);
  const filas = z.array(filaSchema).parse(data ?? []);
  const resumenes = summarizeSales(filas);

  return (
    <>
      <h1 className="font-display text-4xl font-semibold tracking-tight">Reportes de ventas <span className="text-base font-normal text-muted">(confidencial)</span></h1>
      <p className="mt-2 text-muted">
        Cada moneda se resume por separado. No cuentan como venta las reservas canceladas, vencidas o reembolsadas. &quot;Cargo de la agencia&quot; es tu ganancia bruta, antes del ITBIS y de impuestos.
      </p>
      {filas.length >= LIMITE && (
        <p role="status" className="mt-4 rounded-lg border border-bad/40 bg-bad/10 px-4 py-3 text-sm font-medium text-bad">
          Se muestran solo las últimas {LIMITE} reservas.
        </p>
      )}

      {resumenes.length === 0 ? (
        <div className="mt-8"><EmptyState>Todavía no hay reservas.</EmptyState></div>
      ) : (
        resumenes.map((r) => {
          const d = (c: number) => formatMoney(c, r.currency);
          const fila = (b: Bucket) => (
            <>
              <td className="pr-4">{b.count}</td><td className="pr-4">{d(b.totalCents)}</td><td className="pr-4">{d(b.paidCents)}</td><td>{d(b.feeCents)}</td>
            </>
          );
          return (
            <section key={r.currency} aria-labelledby={`r-${r.currency}`} className="mt-8 rounded-[var(--radius-card)] border border-line bg-paper p-6 shadow-[var(--shadow-lift)]">
              <h2 id={`r-${r.currency}`} className="font-display text-2xl font-semibold">Ventas en {r.currency === "USD" ? "dólares (USD)" : "pesos (DOP)"}</h2>
              <dl className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-5">
                <div><dt className="text-muted">Reservas activas</dt><dd className="font-display text-2xl font-semibold">{r.count}</dd></div>
                <div><dt className="text-muted">Vendido</dt><dd className="font-display text-2xl font-semibold">{d(r.totalCents)}</dd></div>
                <div><dt className="text-muted">Cobrado</dt><dd className="font-display text-2xl font-semibold">{d(r.paidCents)}</dd></div>
                <div><dt className="text-muted">Por cobrar</dt><dd className="font-display text-2xl font-semibold">{d(r.pendingCents)}</dd></div>
                <div><dt className="text-muted">Perdidas</dt><dd className="font-display text-2xl font-semibold">{r.lostCount}</dd></div>
              </dl>
              <p className="mt-4 text-sm text-muted">
                Cargo de la agencia: <strong>{d(r.feeCents)}</strong> en total, de los cuales <strong>{d(r.realizedFeeCents)}</strong> ya están en reservas pagadas al 100 %.
              </p>

              <table className="mt-6 w-full text-left text-sm">
                <caption className="sr-only">Ventas por mes en {r.currency}</caption>
                <thead className="text-xs uppercase tracking-wide text-muted"><tr><th className="py-2 pr-4">Mes</th><th className="pr-4">Reservas</th><th className="pr-4">Vendido</th><th className="pr-4">Cobrado</th><th>Cargo agencia</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {r.byMonth.map((m) => <tr key={m.month}><td className="py-2 pr-4 font-semibold">{mesLegible(m.month)}</td>{fila(m)}</tr>)}
                </tbody>
              </table>

              <table className="mt-6 w-full text-left text-sm">
                <caption className="sr-only">Ventas por origen en {r.currency}</caption>
                <thead className="text-xs uppercase tracking-wide text-muted"><tr><th className="py-2 pr-4">Origen</th><th className="pr-4">Reservas</th><th className="pr-4">Vendido</th><th className="pr-4">Cobrado</th><th>Cargo agencia</th></tr></thead>
                <tbody className="divide-y divide-line">
                  <tr><td className="py-2 pr-4 font-semibold">Agentes</td>{fila(r.bySource.AGENT)}</tr>
                  <tr><td className="py-2 pr-4 font-semibold">En línea</td>{fila(r.bySource.ONLINE)}</tr>
                </tbody>
              </table>
            </section>
          );
        })
      )}
    </>
  );
}
