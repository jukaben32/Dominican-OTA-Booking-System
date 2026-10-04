import { COMPANY } from "@/lib/company";
import { signIn } from "./actions";

const MENSAJES: Record<string, string> = {
  credenciales: "Correo o contraseña incorrectos.",
  intentos: "Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.",
  "sin-acceso": "Tu cuenta no tiene acceso al panel. Pide a un administrador que la habilite.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { error } = await searchParams;
  const mensaje = typeof error === "string" ? MENSAJES[error] : undefined;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-16">
      <p className="font-display text-xl font-semibold">{COMPANY.brand}</p>
      <h1 className="mt-6 font-display text-4xl font-semibold tracking-tight">Panel de agentes</h1>
      <p className="mt-2 text-muted">Acceso solo para el personal de la agencia.</p>

      <form action={signIn} className="mt-10 space-y-5 rounded-[var(--radius-card)] border border-line bg-paper p-7 shadow-[var(--shadow-lift)]">
        {mensaje && (
          <p role="alert" className="rounded-lg border border-bad/40 bg-bad/10 px-4 py-3 text-sm font-medium text-bad">
            {mensaje}
          </p>
        )}
        <div>
          <label htmlFor="email" className="block text-sm font-semibold">Correo</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="mt-2 w-full rounded-lg border border-line bg-sand px-4 py-3 text-base"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-semibold">Contraseña</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="mt-2 w-full rounded-lg border border-line bg-sand px-4 py-3 text-base"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded-full bg-ink px-6 py-3.5 text-base font-bold text-sand transition-transform hover:-translate-y-0.5 active:translate-y-0"
        >
          Entrar
        </button>
      </form>
    </main>
  );
}
