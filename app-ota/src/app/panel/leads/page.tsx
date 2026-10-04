import { z } from "zod";
import { EmptyState, Etiqueta, formatDateTime, type Tono } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const filaSchema = z.object({
  id: z.string(),
  status: z.string(),
  source: z.string(),
  trip_summary: z.string().nullable(),
  created_at: z.string(),
  customer: z.object({ full_name: z.string(), phone_e164: z.string() }),
});

const TONO_ESTADO: Record<string, Tono> = { NEW: "aviso", IN_PROGRESS: "neutro", QUOTED: "neutro", WON: "ok", LOST: "malo" };
const NOMBRE_ESTADO: Record<string, string> = {
  NEW: "Nuevo",
  IN_PROGRESS: "En proceso",
  QUOTED: "Cotizado",
  WON: "Ganado",
  LOST: "Perdido",
};
const LIMITE = 100;

export default async function LeadsPage() {
  await requireStaff();
  const db = await createClient();
  const { data, error } = await db
    .from("leads")
    .select("id, status, source, trip_summary, created_at, customer:customers!inner(full_name, phone_e164)")
    .order("created_at", { ascending: false })
    .limit(LIMITE);
  if (error) throw new Error(`No se pudieron cargar los leads: ${error.message}`);

  const leads = z.array(filaSchema).parse(data ?? []);

  return (
    <>
      <h1 className="font-display text-4xl font-semibold tracking-tight">Leads</h1>
      <p className="mt-2 text-muted">Personas que han escrito o pedido una cotización (últimos {LIMITE}).</p>

      <div className="mt-8">
        {leads.length === 0 ? (
          <EmptyState>Todavía no hay leads. Cuando alguien escriba por WhatsApp aparecerá aquí.</EmptyState>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-paper shadow-[var(--shadow-lift)]">
            {leads.map((l) => (
              <li key={l.id} className="grid gap-2 px-6 py-5 md:grid-cols-[1.2fr_2fr_auto] md:items-center">
                <div>
                  <p className="font-bold">{l.customer.full_name}</p>
                  <p className="text-sm text-muted">{l.customer.phone_e164}</p>
                </div>
                <p className="text-sm text-muted">{l.trip_summary ?? "Sin detalle del viaje"}</p>
                <div className="flex items-center gap-3 md:justify-end">
                  <Etiqueta tono={TONO_ESTADO[l.status] ?? "neutro"}>{NOMBRE_ESTADO[l.status] ?? l.status}</Etiqueta>
                  <span className="text-xs text-muted">{formatDateTime(l.created_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
