import { z } from "zod";
import { EmptyState, Etiqueta, formatDateTime } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { approvePaymentAction, attachProofAction, rejectPaymentAction } from "./actions";

const filaSchema = z.object({
  id: z.string(),
  amount_cents: z.number(),
  currency: z.enum(["USD", "DOP"]),
  method: z.string(),
  bank_reference: z.string().nullable(),
  proof_path: z.string().nullable(),
  created_at: z.string(),
  booking: z.object({ code: z.string(), customer: z.object({ full_name: z.string() }) }),
});

const NOMBRE_METODO: Record<string, string> = { CARD: "Tarjeta", TRANSFER: "Transferencia", CASH: "Efectivo" };
const AVISOS: Record<string, { texto: string; tono: "ok" | "malo" }> = {
  "ok:aprobado": { texto: "Pago aprobado y aplicado a la reserva.", tono: "ok" },
  "ok:rechazado": { texto: "Pago rechazado.", tono: "ok" },
  "ok:comprobante": { texto: "Comprobante adjuntado.", tono: "ok" },
  "error:archivo": { texto: "Elige un comprobante válido: foto (JPG, PNG, WebP) o PDF de hasta 5 MB.", tono: "malo" },
  "error:pago": { texto: "Ese pago ya no está pendiente o no se puede aplicar.", tono: "malo" },
  "error:motivo": { texto: "Escribe un motivo de al menos 3 caracteres para rechazar.", tono: "malo" },
  "error:datos": { texto: "Datos inválidos.", tono: "malo" },
  "error:limite": { texto: "Este pago supera tu límite de aprobación. Pídele a un administrador que lo apruebe.", tono: "malo" },
  "error:interno": { texto: "Ocurrió un error. Inténtalo de nuevo; si persiste, avisa a un administrador.", tono: "malo" },
};
const PROOF_URL_SECONDS = 300; // el enlace al comprobante vence a los 5 minutos

export default async function PagosPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireStaff();
  const { ok, error } = await searchParams;
  const aviso =
    typeof ok === "string" ? AVISOS[`ok:${ok}`] : typeof error === "string" ? AVISOS[`error:${error}`] : undefined;

  const db = await createClient();
  const { data, error: errorLectura } = await db
    .from("payments")
    .select(
      "id, amount_cents, currency, method, bank_reference, proof_path, created_at, booking:bookings!inner(code, customer:customers!inner(full_name))",
    )
    .eq("status", "PENDING_VERIFICATION")
    .order("created_at");
  if (errorLectura) throw new Error(`No se pudieron cargar los pagos: ${errorLectura.message}`);

  const pagos = z.array(filaSchema).parse(data ?? []);

  // Los comprobantes están en un almacenamiento PRIVADO: generamos enlaces temporales
  const comprobantes = new Map<string, string>();
  for (const p of pagos) {
    if (!p.proof_path) continue;
    const { data: firmado } = await db.storage.from("payment-proofs").createSignedUrl(p.proof_path, PROOF_URL_SECONDS, { download: true });
    if (firmado?.signedUrl) comprobantes.set(p.id, firmado.signedUrl);
  }

  return (
    <>
      <h1 className="font-display text-4xl font-semibold tracking-tight">Pagos por verificar</h1>
      <p className="mt-2 text-muted">
        Confirma el dinero en la banca en línea <strong>antes</strong> de aprobar. Al aprobar, se aplica a las cuotas y a la reserva.
      </p>

      {aviso && (
        <p
          role="status"
          className={`mt-6 rounded-lg border px-4 py-3 text-sm font-medium ${
            aviso.tono === "ok" ? "border-ok/40 bg-ok/10 text-ok" : "border-bad/40 bg-bad/10 text-bad"
          }`}
        >
          {aviso.texto}
        </p>
      )}

      <div className="mt-8">
        {pagos.length === 0 ? (
          <EmptyState>No hay pagos esperando verificación.</EmptyState>
        ) : (
          <ul className="space-y-4">
            {pagos.map((p) => (
              <li key={p.id} className="rounded-[var(--radius-card)] border border-line bg-paper p-6 shadow-[var(--shadow-lift)]">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="font-display text-3xl font-semibold">{formatMoney(p.amount_cents, p.currency)}</p>
                    <p className="mt-1 text-sm text-muted">
                      {p.booking.code} · {p.booking.customer.full_name} · {formatDateTime(p.created_at)}
                    </p>
                    {p.bank_reference && <p className="mt-1 text-sm">Referencia: <strong>{p.bank_reference}</strong></p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <Etiqueta>{NOMBRE_METODO[p.method] ?? p.method}</Etiqueta>
                    {comprobantes.has(p.id) && (
                      <a
                        href={comprobantes.get(p.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-semibold text-sea underline underline-offset-4"
                      >
                        Ver comprobante
                      </a>
                    )}
                  </div>
                </div>

                {p.method === "TRANSFER" && !p.proof_path && (
                  <form action={attachProofAction} className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-bad/30 bg-bad/5 p-4">
                    <input type="hidden" name="paymentId" value={p.id} />
                    <div>
                      <label htmlFor={`proof-${p.id}`} className="block text-xs font-semibold text-bad">Sin comprobante: adjúntalo (foto o PDF, hasta 5 MB)</label>
                      <input
                        id={`proof-${p.id}`}
                        name="proof"
                        type="file"
                        required
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        className="mt-1 text-sm"
                      />
                    </div>
                    <button type="submit" className="rounded-full border border-line bg-paper px-5 py-2.5 text-sm font-bold">
                      Adjuntar
                    </button>
                  </form>
                )}

                <div className="mt-5 flex flex-wrap items-end gap-4 border-t border-line pt-5">
                  <form action={approvePaymentAction}>
                    <input type="hidden" name="paymentId" value={p.id} />
                    <button
                      type="submit"
                      className="rounded-full bg-ok px-6 py-3 text-sm font-bold text-white transition-transform hover:-translate-y-0.5 active:translate-y-0"
                    >
                      Aprobar y aplicar
                    </button>
                  </form>
                  <form action={rejectPaymentAction} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="paymentId" value={p.id} />
                    <div>
                      <label htmlFor={`motivo-${p.id}`} className="block text-xs font-semibold text-muted">Motivo del rechazo (lo ve el cliente de una reserva en línea)</label>
                      <input
                        id={`motivo-${p.id}`}
                        name="reason"
                        required
                        minLength={3}
                        maxLength={300}
                        className="mt-1 w-64 rounded-lg border border-line bg-sand px-3 py-2 text-sm"
                      />
                    </div>
                    <button
                      type="submit"
                      className="rounded-full border border-bad px-5 py-2.5 text-sm font-bold text-bad hover:bg-bad/10"
                    >
                      Rechazar
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
