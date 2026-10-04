// Formatos de presentación compartidos (pantallas y documentos), siempre en horario dominicano.

// Fecha y hora: "4 oct 2026, 10:30 a. m."
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-DO", {
    timeZone: "America/Santo_Domingo",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// "2026-10-18" -> "18/10/2026" (las fechas de calendario no llevan zona horaria: no se convierten)
export function formatDay(fecha: string): string {
  const [y, m, d] = fecha.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
