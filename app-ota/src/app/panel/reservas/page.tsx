import { z } from "zod";
import Link from "next/link";
import { EmptyState, Etiqueta, formatDateTime, type Tono } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

const filaSchema = z.object({
  id: z.string(),
  code: z.string(),
  status: z.string(),
  product_type: z.string(),
  currency: z.enum(["USD", "DOP"]),
  total_cents: z.number(),
  paid_cents: z.number(),
  requires_review: z.boolean(),
  review_reasons: z.array(z.string()),
  price_guaranteed: z.boolean(),
  supplier_deadline: z.string().nullable(),
  source: z.enum(["AGENT", "ONLINE"]),
  customer: z.object({ full_name: z.string() }),
});

const NOMBRE_ESTADO: Record<string, string> = {
  QUOTED: "Cotizada",
  ON_HOLD: "En espera",
  PENDING_PAYMENT: "Por pagar",
  PARTIALLY_PAID: "Pago parcial",
  PAID: "Pagada",
  TICKETED: "Emitida",
  CANCELLED: "Cancelada",
  EXPIRED: "Vencida",
  REFUNDED: "Reembolsada",
};
const TONO_ESTADO: Record<string, Tono> = {
  PAID: "ok",
  TICKETED: "ok",
  PARTIALLY_PAID: "aviso",
  PENDING_PAYMENT: "aviso",
  ON_HOLD: "aviso",
  CANCELLED: "malo",
  EXPIRED: "malo",
};
const NOMBRE_RAZON: Record<string, string> = {
  SALIDA_PROXIMA: "Sale en menos de 72 h",
  TITULAR_NO_ES_PASAJERO: "Titular de la tarjeta no es pasajero",
  TARJETA_EXTRANJERA_MONTO_ALTO: "Tarjeta extranjera con monto alto",
  MUCHOS_INTENTOS: "Varios intentos de pago",
  CUENTA_NUEVA: "Cuenta recién creada",
};
const LIMITE = 100;

export default async function ReservasPage() {
  await requireStaff();
  const db = await createClient();
  const { data, error } = await db
    .from("bookings")
    .select(
      "id, code, status, product_type, currency, total_cents, paid_cents, requires_review, review_reasons, price_guaranteed, supplier_deadline, source, customer:customers!inner(full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(LIMITE);
  if (error) throw new Error(`No se pudieron cargar las reservas: ${error.message}`);

  const reservas = z.array(filaSchema).parse(data ?? []);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-semibold tracking-tight">Reservas</h1>
          <p className="mt-2 text-muted">Estado de cobro de cada reserva (últimas {LIMITE}). El boleto se emite solo con el pago completo.</p>
        </div>
        <Link href="/panel/reservas/nueva" className="rounded-full bg-coral px-6 py-3 text-sm font-bold text-[#1a0a04] shadow-[var(--shadow-lift)] transition-transform hover:-translate-y-0.5">
          Nueva reserva
        </Link>
      </div>

      <div className="mt-8">
        {reservas.length === 0 ? (
          <EmptyState>Todavía no hay reservas. Crea la primera con el botón &quot;Nueva reserva&quot;.</EmptyState>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-paper shadow-[var(--shadow-lift)]">
            {reservas.map((r) => {
              const porcentaje = Math.min(100, Math.round((r.paid_cents / r.total_cents) * 100));
              return (
                <li key={r.id} className="grid gap-3 px-6 py-5 md:grid-cols-[1fr_1.4fr_auto] md:items-center">
                  <div>
                    <Link href={`/panel/reservas/${r.id}`} className="font-display text-xl font-semibold underline decoration-line underline-offset-4 hover:decoration-coral">{r.code}</Link>
                    <p className="text-sm text-muted">{r.customer.full_name}</p>
                  </div>
                  <div>
                    <p className="text-sm">
                      <span className="font-bold">{formatMoney(r.paid_cents, r.currency)}</span>
                      <span className="text-muted"> de {formatMoney(r.total_cents, r.currency)}</span>
                    </p>
                    <div
                      role="progressbar"
                      aria-label={`Pagado ${porcentaje} %`}
                      aria-valuenow={porcentaje}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className="mt-2 h-2 overflow-hidden rounded-full bg-line"
                    >
                      <div className="h-full rounded-full bg-coral" style={{ width: `${porcentaje}%` }} />
                    </div>
                    {!r.price_guaranteed && r.status !== "TICKETED" && (
                      <p className="mt-2 text-xs text-muted">Precio no garantizado hasta emitir</p>
                    )}
                    {r.supplier_deadline && r.status !== "TICKETED" && (
                      <p className="mt-1 text-xs text-muted">Vence con el proveedor: {formatDateTime(r.supplier_deadline)}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    <Etiqueta tono={TONO_ESTADO[r.status] ?? "neutro"}>{NOMBRE_ESTADO[r.status] ?? r.status}</Etiqueta>
                    {r.source === "ONLINE" && <Etiqueta tono="aviso">Reserva en línea</Etiqueta>}
                    {r.requires_review && (
                      <Etiqueta tono="malo">
                        Revisar: {r.review_reasons.map((x) => NOMBRE_RAZON[x] ?? x).join(", ")}
                      </Etiqueta>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
