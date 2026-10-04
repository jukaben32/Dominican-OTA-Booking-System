// Pase de abordar ilustrativo: muestra de forma visual cómo se ve un viaje pagado por etapas.
// Es decorativo (aria-hidden): los datos son un ejemplo, no una reserva real.

export function BoardingPass() {
  return (
    <div
      aria-hidden="true"
      className="float-card relative w-full max-w-md rounded-[var(--radius-card)] border border-line bg-paper shadow-[var(--shadow-lift)]"
    >
      <div className="flex items-stretch">
        {/* Cuerpo del boleto */}
        <div className="flex-1 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Pase de ejemplo</p>
          <div className="mt-4 flex items-end gap-4">
            <div>
              <p className="font-display text-5xl font-semibold leading-none text-ink">JFK</p>
              <p className="mt-1 text-xs text-muted">Nueva York</p>
            </div>
            <svg viewBox="0 0 64 24" className="mb-3 h-6 w-16 shrink-0 text-coral" fill="none">
              <path d="M2 12h52" stroke="currentColor" strokeWidth="2" strokeDasharray="3 5" strokeLinecap="round" />
              <path d="m52 5 10 7-10 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div>
              <p className="font-display text-5xl font-semibold leading-none text-ink">SDQ</p>
              <p className="mt-1 text-xs text-muted">Santo Domingo</p>
            </div>
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted">Salida</dt>
              <dd className="font-semibold text-ink">20 dic · 7:40 a. m.</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Pasajeros</dt>
              <dd className="font-semibold text-ink">2 adultos</dd>
            </div>
          </dl>

          {/* Progreso de pagos */}
          <div className="mt-6 rounded-xl bg-sand p-4">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-semibold text-ink">Apartado sin intereses</span>
              <span className="text-muted">2 de 5 pagos</span>
            </div>
            <div className="mt-3 flex gap-1.5">
              {[true, true, false, false, false].map((pagado, i) => (
                <span key={i} className={`h-2 flex-1 rounded-full ${pagado ? "bg-coral" : "bg-line"}`} />
              ))}
            </div>
          </div>
        </div>

        {/* Talón perforado */}
        <div className="perforation w-3 shrink-0" />
        <div className="flex w-20 shrink-0 flex-col items-center justify-between py-6">
          <p className="[writing-mode:vertical-rl] rotate-180 text-xs font-semibold uppercase tracking-[0.3em] text-muted">
            Clase turista
          </p>
          <svg viewBox="0 0 40 40" className="h-9 w-9 text-sea" fill="currentColor">
            {[0, 1, 2, 3, 4].flatMap((r) =>
              [0, 1, 2, 3, 4].map((c) => ((r * 5 + c) % 3 !== 1 ? <rect key={`${r}-${c}`} x={c * 8} y={r * 8} width="6" height="6" rx="1" /> : null)),
            )}
          </svg>
        </div>
      </div>
    </div>
  );
}
