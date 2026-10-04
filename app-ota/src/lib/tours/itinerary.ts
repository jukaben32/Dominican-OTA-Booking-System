// El itinerario y las listas ("incluye" / "no incluye") se escriben como TEXTO sencillo en el panel y se
// convierten a datos ordenados. Así el agente no necesita un editor complicado.
//
// Formato del itinerario (un bloque por día, separados por una línea en blanco):
//   Día 1: Llegada a Medellín
//   Recepción en el aeropuerto y traslado al hotel.
//
//   Día 2: Comuna 13
//   Tour guiado.

export interface ItineraryDay {
  day: number;
  title: string;
  description: string;
}

export class ItineraryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ItineraryError";
  }
}

const MAX_DAYS = 60;
const MAX_TITLE = 120;
const MAX_DESCRIPTION = 2000;
const MAX_LIST_ITEMS = 40;
const MAX_LIST_ITEM_LENGTH = 200;

// "Día 1: Título", "dia 2 - Título", "3. Título"
const ENCABEZADO = /^(?:d[ií]a\s*)?(\d{1,3})\s*[:.\-–—]\s*(.+)$/i;

export function parseItinerary(texto: string): ItineraryDay[] {
  const bloques = texto
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  if (bloques.length > MAX_DAYS) throw new ItineraryError(`El itinerario puede tener como máximo ${MAX_DAYS} días`);

  return bloques.map((bloque, indice) => {
    const [primera, ...resto] = bloque.split("\n");
    const encabezado = ENCABEZADO.exec(primera.trim());
    if (!encabezado) {
      throw new ItineraryError(
        `El bloque ${indice + 1} debe empezar con "Día ${indice + 1}: título" (lo que tiene es: "${primera.trim().slice(0, 40)}")`,
      );
    }

    const day = Number(encabezado[1]);
    if (day !== indice + 1) {
      throw new ItineraryError(`Los días deben ser consecutivos desde el 1: en el bloque ${indice + 1} dice "Día ${day}"`);
    }

    const title = encabezado[2].trim();
    const description = resto.map((l) => l.trim()).join("\n").trim();
    if (title.length > MAX_TITLE) throw new ItineraryError(`El título del día ${day} supera ${MAX_TITLE} caracteres`);
    if (description.length > MAX_DESCRIPTION) {
      throw new ItineraryError(`La descripción del día ${day} supera ${MAX_DESCRIPTION} caracteres`);
    }
    return { day, title, description };
  });
}

export function formatItinerary(dias: readonly ItineraryDay[]): string {
  return dias
    .map((d) => `Día ${d.day}: ${d.title}${d.description ? `\n${d.description}` : ""}`)
    .join("\n\n");
}

// Una línea por elemento; ignora viñetas, espacios y repetidos
export function parseLines(texto: string): string[] {
  const vistos = new Set<string>();
  const lineas: string[] = [];
  for (const cruda of texto.replace(/\r\n/g, "\n").split("\n")) {
    const linea = cruda.trim().replace(/^[-•*]\s*/, "").trim();
    if (!linea) continue;
    if (linea.length > MAX_LIST_ITEM_LENGTH) {
      throw new ItineraryError(`Cada línea puede tener como máximo ${MAX_LIST_ITEM_LENGTH} caracteres`);
    }
    const clave = linea.toLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    lineas.push(linea);
  }
  if (lineas.length > MAX_LIST_ITEMS) throw new ItineraryError(`Máximo ${MAX_LIST_ITEMS} líneas`);
  return lineas;
}
