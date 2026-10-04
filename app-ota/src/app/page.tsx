import Link from "next/link";
import { BoardingPass } from "@/components/boarding-pass";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { COMPANY, whatsappLink } from "@/lib/company";

const PASOS = [
  {
    titulo: "Cuéntanos tu viaje",
    texto: "Escríbenos por WhatsApp: de dónde sales, a dónde vas y cuándo. Una persona real te responde, no un menú.",
  },
  {
    titulo: "Recibe tu cotización clara",
    texto: "Te enviamos el precio total con todo incluido y las formas de pago. Sin letra pequeña ni sorpresas al final.",
  },
  {
    titulo: "Paga y viaja tranquilo",
    texto: "Pagas a tu manera. Cuando el pago está completo emitimos tu boleto y te lo mandamos por WhatsApp y correo.",
  },
];

const FORMAS_DE_PAGO = [
  {
    titulo: "Pago completo",
    texto: "Con tarjeta de crédito o débito, o por transferencia. Tu boleto sale en cuanto se confirma el pago.",
    clases: "bg-paper text-ink md:col-span-2",
  },
  {
    titulo: "Cuotas con tu tarjeta",
    texto: "Divide el pago con el programa de cuotas de tu banco, cuando tu tarjeta lo permita.",
    clases: "bg-sea-deep text-[#f3ebdb]",
  },
  {
    titulo: "Apartado sin intereses",
    texto:
      "En grupos y paquetes con cupo garantizado, aparta con un abono inicial y completa en pagos programados. Cero intereses, cero recargos.",
    clases: "bg-coral text-[#1a0a04] md:col-span-3",
  },
];

const GARANTIAS = [
  {
    titulo: "Agencia con licencia",
    texto: COMPANY.miturRut
      ? `Licencia del Ministerio de Turismo, RUT ${COMPANY.miturRut}.`
      : "Licencia del Ministerio de Turismo (MITUR): en trámite.",
  },
  { titulo: "Factura electrónica", texto: "Cada compra con su comprobante fiscal electrónico (e-CF)." },
  { titulo: "Precio total desde el inicio", texto: "Te decimos qué parte es el boleto y cuál es nuestro cargo por servicio." },
  { titulo: "Atención humana", texto: "Cambios, cancelaciones y dudas con una persona, no con un formulario." },
];

export default function Home() {
  const enlaceWhatsapp = whatsappLink("Hola, quiero cotizar un viaje");

  return (
    <>
      <SiteHeader />

      <main id="inicio">
        {/* Portada */}
        <section aria-labelledby="titulo-principal" className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-24 pt-10 md:grid-cols-[1.15fr_1fr] md:pt-16">
          <div>
            <p className="rise text-sm font-semibold uppercase tracking-[0.22em] text-coral-deep" style={{ "--i": 0 } as React.CSSProperties}>
              Vuelos desde y hacia República Dominicana
            </p>
            <h1
              id="titulo-principal"
              className="rise mt-5 font-display text-[clamp(2.8rem,7vw,5.6rem)] font-semibold leading-[0.98] tracking-tight"
              style={{ "--i": 1 } as React.CSSProperties}
            >
              Tu viaje a casa,
              <br />
              <em className="font-medium text-coral-deep">pagado a tu ritmo.</em>
            </h1>
            <p className="rise mt-7 max-w-xl text-lg leading-relaxed text-muted" style={{ "--i": 2 } as React.CSSProperties}>
              Compra tu boleto hablando con una persona por WhatsApp, con el precio total claro y opciones para pagar
              como te convenga.
            </p>
            <div className="rise mt-9 flex flex-wrap items-center gap-4" style={{ "--i": 3 } as React.CSSProperties}>
              {enlaceWhatsapp && (
                <a
                  href={enlaceWhatsapp}
                  className="rounded-full bg-coral px-7 py-4 text-base font-bold text-[#1a0a04] shadow-[var(--shadow-lift)] transition-transform hover:-translate-y-0.5 active:translate-y-0"
                >
                  Cotizar mi viaje por WhatsApp
                </a>
              )}
              <Link href="/tours" className="px-2 py-4 text-base font-semibold underline decoration-coral decoration-2 underline-offset-8">
                Ver tours y salidas
              </Link>
            </div>
          </div>
          <div className="rise flex justify-center md:justify-end" style={{ "--i": 3 } as React.CSSProperties}>
            <BoardingPass />
          </div>
        </section>

        {/* Cómo funciona */}
        <section id="como-funciona" aria-labelledby="titulo-pasos" className="border-y border-line bg-paper">
          <div className="mx-auto w-full max-w-6xl px-5 py-20">
            <h2 id="titulo-pasos" className="max-w-2xl font-display text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
              Tres pasos, una conversación.
            </h2>
            <ol className="mt-14 grid gap-10 md:grid-cols-3">
              {PASOS.map((paso, i) => (
                <li key={paso.titulo} className={i === 1 ? "md:mt-10" : i === 2 ? "md:mt-20" : ""}>
                  <span aria-hidden="true" className="font-display text-7xl font-semibold leading-none text-coral">
                    {i + 1}
                  </span>
                  <h3 className="mt-3 text-xl font-bold">{paso.titulo}</h3>
                  <p className="mt-2 leading-relaxed text-muted">{paso.texto}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Formas de pago */}
        <section id="pagos" aria-labelledby="titulo-pagos" className="mx-auto w-full max-w-6xl px-5 py-24">
          <h2 id="titulo-pagos" className="max-w-2xl font-display text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
            Paga como te convenga.
          </h2>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {FORMAS_DE_PAGO.map((forma) => (
              <article
                key={forma.titulo}
                className={`rounded-[var(--radius-card)] border border-line p-8 shadow-[var(--shadow-lift)] ${forma.clases}`}
              >
                <h3 className="font-display text-2xl font-semibold">{forma.titulo}</h3>
                <p className="mt-3 max-w-xl leading-relaxed opacity-90">{forma.texto}</p>
              </article>
            ))}
          </div>
          <p className="mt-6 max-w-2xl text-sm text-muted">
            Las cuotas con tarjeta dependen de tu banco y el apartado aplica solo a grupos y paquetes con cupo
            garantizado. Te confirmamos qué opción tienes disponible en tu cotización.
          </p>
        </section>

        {/* Confianza */}
        <section id="confianza" aria-labelledby="titulo-confianza" className="bg-sea-deep text-[#f3ebdb]">
          <div className="mx-auto w-full max-w-6xl px-5 py-20">
            <h2 id="titulo-confianza" className="max-w-2xl font-display text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
              Viajar tranquilo empieza por confiar.
            </h2>
            <dl className="mt-12 grid gap-x-12 gap-y-8 md:grid-cols-2">
              {GARANTIAS.map((g) => (
                <div key={g.titulo} className="border-t border-[#f3ebdb]/25 pt-5">
                  <dt className="text-lg font-bold">{g.titulo}</dt>
                  <dd className="mt-1 leading-relaxed text-[#f3ebdb]/80">{g.texto}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Cierre */}
        <section aria-labelledby="titulo-cierre" className="mx-auto w-full max-w-6xl px-5 py-24 text-center">
          <h2 id="titulo-cierre" className="mx-auto max-w-3xl font-display text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
            ¿Ya sabes a dónde quieres ir?
          </h2>
          {enlaceWhatsapp && (
            <a
              href={enlaceWhatsapp}
              className="mt-10 inline-block rounded-full bg-coral px-8 py-4 text-base font-bold text-[#1a0a04] shadow-[var(--shadow-lift)] transition-transform hover:-translate-y-0.5 active:translate-y-0"
            >
              Hablemos por WhatsApp
            </a>
          )}
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
