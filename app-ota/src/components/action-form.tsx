"use client";

// Formulario que ejecuta una acción del servidor y muestra el error si la hay (sin recargar la página).
// Los mensajes de error los escribe el servidor (texto propio, no del usuario), por eso es seguro mostrarlos.

import { useActionState } from "react";

export interface ActionState {
  error?: string;
}

type Accion = (anterior: ActionState, datos: FormData) => Promise<ActionState>;

interface Props {
  action: Accion;
  children: React.ReactNode;
  submitLabel: string;
  className?: string;
  variant?: "primary" | "quiet";
}

export function ActionForm({ action, children, submitLabel, className = "", variant = "primary" }: Props) {
  const [estado, ejecutar, pendiente] = useActionState(action, {});

  return (
    <form action={ejecutar} className={className}>
      {estado.error && (
        <p role="alert" className="mb-4 rounded-lg border border-bad/40 bg-bad/10 px-4 py-3 text-sm font-medium text-bad">
          {estado.error}
        </p>
      )}
      {children}
      <button
        type="submit"
        disabled={pendiente}
        className={`mt-5 rounded-full px-6 py-3 text-sm font-bold transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:cursor-wait disabled:opacity-60 ${
          variant === "primary" ? "bg-ink text-sand" : "border border-line bg-paper text-ink"
        }`}
      >
        {pendiente ? "Guardando…" : submitLabel}
      </button>
    </form>
  );
}

// Campo de formulario con etiqueta visible (accesible) y estilo consistente
export function Field({
  label,
  name,
  hint,
  className = "",
  children,
}: {
  label: string;
  name: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={name} className="block text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export const inputClass = "mt-2 w-full rounded-lg border border-line bg-sand px-4 py-3 text-base";
