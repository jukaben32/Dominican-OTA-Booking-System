import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { COMPANY } from "@/lib/company";
import { requireStaff } from "@/lib/auth";

const ENLACES = [
  { href: "/panel", etiqueta: "Resumen" },
  { href: "/panel/leads", etiqueta: "Leads" },
  { href: "/panel/reservas", etiqueta: "Reservas" },
  { href: "/panel/salidas", etiqueta: "Vender salidas" },
  { href: "/panel/pagos", etiqueta: "Pagos por verificar" },
];

// Solo los administradores ven el catálogo, los costos, las políticas y los requisitos
const ENLACES_ADMIN = [
  { href: "/panel/tours", etiqueta: "Tours" },
  { href: "/panel/reembolsos", etiqueta: "Reembolsos" },
  { href: "/panel/reportes", etiqueta: "Reportes" },
  { href: "/panel/politicas", etiqueta: "Políticas" },
  { href: "/panel/requisitos", etiqueta: "Requisitos" },
];

export default async function PanelLayout({ children }: LayoutProps<"/panel">) {
  // Verifica el rol en CADA petición: la seguridad no depende solo del proxy
  const usuario = await requireStaff();
  const enlaces = usuario.role === "ADMIN" ? [...ENLACES, ...ENLACES_ADMIN] : ENLACES;

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <p className="font-display text-lg font-semibold">{COMPANY.brand}</p>
          <nav aria-label="Panel" className="flex flex-wrap gap-1 text-sm font-semibold">
            {enlaces.map((e) => (
              <Link key={e.href} href={e.href} className="rounded-full px-4 py-2 hover:bg-sand">
                {e.etiqueta}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted">{usuario.fullName ?? usuario.email} · {usuario.role === "ADMIN" ? "Admin" : "Agente"}</span>
            <form action={signOut}>
              <button type="submit" className="rounded-full border border-line px-4 py-2 font-semibold hover:bg-sand">
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-5 py-10">{children}</main>
    </div>
  );
}
