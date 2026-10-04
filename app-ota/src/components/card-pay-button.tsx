"use client";

// Botón "Pagar con tarjeta": pide al servidor el formulario firmado y lo envía por POST a la página de Azul.
// La tarjeta se escribe en el sitio de Azul; aquí nunca se ve ni se toca un número de tarjeta.

import { useActionState, useEffect, useRef } from "react";
import type { CardState } from "@/app/mi-reserva/[token]/card-actions";

interface Props {
  action: (anterior: CardState, datos: FormData) => Promise<CardState>;
  token: string;
}

export function CardPayButton({ action, token }: Props) {
  const [estado, ejecutar, pendiente] = useActionState(action, {});
  const formularioAzul = useRef<HTMLFormElement>(null);

  // En cuanto llega el formulario firmado, el navegador lo envía a Azul
  useEffect(() => {
    if (estado.form) formularioAzul.current?.submit();
  }, [estado.form]);

  return (
    <div>
      {estado.error && (
        <p role="alert" className="mb-3 rounded-lg border border-bad/40 bg-bad/10 px-4 py-3 text-sm font-medium text-bad">
          {estado.error}
        </p>
      )}
      <form action={ejecutar}>
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          disabled={pendiente || Boolean(estado.form)}
          className="rounded-full bg-ink px-6 py-3 text-sm font-bold text-sand transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:cursor-wait disabled:opacity-60"
        >
          {pendiente || estado.form ? "Llevándote a la página de pago…" : "Pagar con tarjeta"}
        </button>
      </form>

      {estado.form && (
        <form ref={formularioAzul} method="post" action={estado.form.actionUrl} className="hidden">
          {Object.entries(estado.form.fields).map(([nombre, valor]) => (
            <input key={nombre} type="hidden" name={nombre} value={valor} />
          ))}
        </form>
      )}
    </div>
  );
}
