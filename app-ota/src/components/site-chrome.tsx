import Link from "next/link";
import { COMPANY, whatsappLink } from "@/lib/company";

// Cabecera y pie de las páginas públicas (portada, lista de tours y página de cada tour)
export function SiteHeader() {
  const enlaceWhatsapp = whatsappLink("Hola, quiero cotizar un viaje");
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-6">
      <Link href="/" className="font-display text-xl font-semibold tracking-tight">
        {COMPANY.brand}
      </Link>
      <nav aria-label="Principal" className="hidden items-center gap-8 text-sm font-medium md:flex">
        <Link className="hover:text-coral-deep" href="/tours">Tours</Link>
        <Link className="hover:text-coral-deep" href="/#como-funciona">Cómo funciona</Link>
        <Link className="hover:text-coral-deep" href="/#pagos">Formas de pago</Link>
        <Link className="hover:text-coral-deep" href="/#confianza">Confianza</Link>
      </nav>
      {enlaceWhatsapp && (
        <a href={enlaceWhatsapp} className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-sand transition-transform hover:-translate-y-0.5 active:translate-y-0">
          Escríbenos
        </a>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-8 text-sm text-muted md:flex-row md:justify-between">
        <p>© {new Date().getFullYear()} {COMPANY.brand}. Todos los derechos reservados.</p>
        <p>{COMPANY.miturRut ? `Licencia MITUR RUT ${COMPANY.miturRut}` : "Licencia MITUR: en trámite"}</p>
      </div>
    </footer>
  );
}
