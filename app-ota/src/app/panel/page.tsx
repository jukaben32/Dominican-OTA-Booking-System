import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

// Cuenta filas sin traerlas (rápido): "head: true" solo pide el conteo
async function contar(consulta: PromiseLike<{ count: number | null; error: { message: string } | null }>) {
  const { count, error } = await consulta;
  if (error) throw new Error(`No se pudo calcular el resumen: ${error.message}`);
  return count ?? 0;
}

export default async function ResumenPage() {
  const db = await createClient();
  const conteo = { count: "exact", head: true } as const;

  const [leadsNuevos, porCobrar, pagosPendientes, cuotasVencidas, paraRevisar] = await Promise.all([
    contar(db.from("leads").select("id", conteo).eq("status", "NEW")),
    contar(db.from("bookings").select("id", conteo).in("status", ["PENDING_PAYMENT", "PARTIALLY_PAID"])),
    contar(db.from("payments").select("id", conteo).eq("status", "PENDING_VERIFICATION")),
    contar(db.from("installments").select("id", conteo).eq("status", "OVERDUE")),
    contar(
      db.from("bookings").select("id", conteo).eq("requires_review", true).not("status", "in", "(TICKETED,CANCELLED,EXPIRED,REFUNDED)"),
    ),
  ]);

  const tarjetas = [
    { etiqueta: "Leads nuevos", valor: leadsNuevos, href: "/panel/leads", alerta: false },
    { etiqueta: "Reservas por cobrar", valor: porCobrar, href: "/panel/reservas", alerta: false },
    { etiqueta: "Pagos por verificar", valor: pagosPendientes, href: "/panel/pagos", alerta: pagosPendientes > 0 },
    { etiqueta: "Cuotas vencidas", valor: cuotasVencidas, href: "/panel/reservas", alerta: cuotasVencidas > 0 },
    { etiqueta: "Reservas para revisar (fraude)", valor: paraRevisar, href: "/panel/reservas", alerta: paraRevisar > 0 },
  ];

  return (
    <>
      <h1 className="font-display text-4xl font-semibold tracking-tight">Resumen</h1>
      <p className="mt-2 text-muted">Lo que necesita tu atención hoy.</p>
      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tarjetas.map((t) => (
          <li key={t.etiqueta}>
            <Link
              href={t.href}
              className="block rounded-[var(--radius-card)] border border-line bg-paper p-6 shadow-[var(--shadow-lift)] transition-transform hover:-translate-y-0.5"
            >
              <p className="text-sm font-semibold text-muted">{t.etiqueta}</p>
              <p className={`mt-3 font-display text-6xl font-semibold leading-none ${t.alerta ? "text-coral-deep" : "text-ink"}`}>
                {t.valor}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
