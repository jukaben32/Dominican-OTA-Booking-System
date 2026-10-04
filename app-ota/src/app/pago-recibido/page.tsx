import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { whatsappLink } from "@/lib/company";

export const metadata: Metadata = { title: "Pago con tarjeta — Dominican OTA Booking", robots: { index: false, follow: false } };

const MENSAJES: Record<string, { titulo: string; texto: string }> = {
  aprobado: { titulo: "¡Pago recibido!", texto: "Tu pago con tarjeta fue aprobado. Un asesor te confirmará los detalles de tu reserva." },
  declinado: { titulo: "El pago no se completó", texto: "El banco no aprobó la tarjeta. No se te cobró nada. Puedes intentarlo con otra tarjeta o pagar por transferencia." },
  cancelado: { titulo: "Cancelaste el pago", texto: "No se te cobró nada. Cuando quieras puedes volver a intentarlo." },
  revision: { titulo: "Estamos revisando tu pago", texto: "Recibimos la respuesta del banco y un asesor la está verificando. No vuelvas a pagar: te escribiremos." },
  error: { titulo: "No pudimos confirmar el pago", texto: "Si te cobraron, no te preocupes: un asesor lo revisará. Escríbenos y lo resolvemos." },
};

export default async function PagoRecibidoPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { estado } = await searchParams;
  const mensaje = MENSAJES[typeof estado === "string" ? estado : ""] ?? MENSAJES.error;
  const ayuda = whatsappLink("Hola, tengo una duda con mi pago con tarjeta");

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl px-5 py-16">
        <h1 className="font-display text-4xl font-semibold tracking-tight">{mensaje.titulo}</h1>
        <p className="mt-4 text-lg text-muted">{mensaje.texto}</p>
        <div className="mt-8 flex flex-wrap gap-4 text-sm font-semibold">
          <Link href="/tours" className="text-sea underline underline-offset-4">Ver tours</Link>
          {ayuda && <a href={ayuda} className="text-sea underline underline-offset-4">Escribir por WhatsApp</a>}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
