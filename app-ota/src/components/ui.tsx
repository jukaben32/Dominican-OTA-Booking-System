// Piezas de interfaz compartidas por las pantallas del panel.

const TONOS = {
  neutro: "border-line bg-sand text-ink",
  ok: "border-ok/40 bg-ok/10 text-ok",
  aviso: "border-warn/40 bg-warn/10 text-warn",
  malo: "border-bad/40 bg-bad/10 text-bad",
} as const;

export type Tono = keyof typeof TONOS;

export function Etiqueta({ tono = "neutro", children }: { tono?: Tono; children: React.ReactNode }) {
  return (
    <span className={`inline-block rounded-full border px-3 py-1 text-xs font-bold ${TONOS[tono]}`}>{children}</span>
  );
}

// Los formatos viven en lib/format.ts; se re-exportan aquí para las pantallas
export { formatDateTime, formatDay } from "@/lib/format";

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-[var(--radius-card)] border border-dashed border-line bg-paper px-6 py-12 text-center text-muted">
      {children}
    </p>
  );
}
