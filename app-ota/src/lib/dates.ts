// Utilidades de fechas.
// Trabajamos con fechas de calendario en texto "AAAA-MM-DD" y las calculamos en UTC,
// así el resultado no cambia según la zona horaria del servidor.

export type IsoDate = string;

const MS_POR_DIA = 86_400_000;

// Estricto a propósito: una marca de tiempo con hora ("2026-12-01T03:00:00Z") daría NaN en silencio y
// fechas de cuotas imposibles. Si viene de la base como timestamptz, conviértela antes con todayInSantoDomingo().
function parse(fecha: IsoDate): Date {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!partes) throw new Error(`Fecha inválida (se espera AAAA-MM-DD): "${fecha}"`);
  const [y, m, d] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  const resultado = new Date(Date.UTC(y, m - 1, d));
  // Rechaza días imposibles como 2026-13-40 o 2026-02-31
  if (resultado.getUTCFullYear() !== y || resultado.getUTCMonth() !== m - 1 || resultado.getUTCDate() !== d) {
    throw new Error(`Fecha inválida (se espera AAAA-MM-DD): "${fecha}"`);
  }
  return resultado;
}

// ¿Es una fecha de calendario real en formato AAAA-MM-DD? (rechaza 2026-02-31 o "hola")
export function isIsoDate(texto: string): boolean {
  try {
    parse(texto);
    return true;
  } catch {
    return false;
  }
}

function format(fecha: Date): IsoDate {
  return fecha.toISOString().slice(0, 10);
}

// Suma (o resta, con negativos) días a una fecha
export function addDays(fecha: IsoDate, dias: number): IsoDate {
  return format(new Date(parse(fecha).getTime() + dias * MS_POR_DIA));
}

// Suma meses de calendario; si el día no existe en el mes destino, usa el último día
// (31 de enero + 1 mes = 28 de febrero)
export function addMonths(fecha: IsoDate, meses: number): IsoDate {
  const base = parse(fecha);
  const dia = base.getUTCDate();
  const destino = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + meses, 1),
  );
  const ultimoDia = new Date(
    Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0),
  ).getUTCDate();
  destino.setUTCDate(Math.min(dia, ultimoDia));
  return format(destino);
}

// "Hoy" según el calendario dominicano (UTC-4, sin horario de verano).
// El servidor corre en UTC: sin esto, los recordatorios de la noche saldrían un día adelantados.
export function todayInSantoDomingo(ahora: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santo_Domingo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

// Convierte lo que elige una persona en un campo "fecha y hora" (2026-12-20T12:00), que es hora de
// República Dominicana (UTC-4 todo el año), a la marca de tiempo UTC que guarda la base de datos.
// Devuelve null si el texto no es una fecha y hora válida.
export function santoDomingoLocalToIso(texto: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(texto.trim());
  if (!m) return null;
  const [, dia, hora, minuto, segundo = "00"] = m;
  if (Number(hora) > 23 || Number(minuto) > 59 || Number(segundo) > 59) return null;
  try {
    parse(dia); // valida que el día exista
  } catch {
    return null;
  }
  return new Date(`${dia}T${hora}:${minuto}:${segundo}-04:00`).toISOString();
}

// Operación inversa: una marca de tiempo UTC -> "2026-12-20T12:00" en hora dominicana (para rellenar un formulario)
export function isoToSantoDomingoLocal(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "";
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santo_Domingo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(fecha);
  const v = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${v("year")}-${v("month")}-${v("day")}T${v("hour")}:${v("minute")}`;
}

// Días que hay de "desde" hasta "hasta" (negativo si "hasta" es anterior)
export function diffDays(desde: IsoDate, hasta: IsoDate): number {
  return Math.round((parse(hasta).getTime() - parse(desde).getTime()) / MS_POR_DIA);
}
