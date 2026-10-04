// Validación de los formularios del administrador del catálogo de tours.
// Son funciones PURAS: reciben el texto del formulario y devuelven datos limpios o un mensaje claro en español.
// (La base de datos vuelve a exigir las reglas importantes: esto es para dar buenos mensajes y para no confiar en el navegador.)

import { isIsoDate, santoDomingoLocalToIso, type IsoDate } from "../dates";
import { parseMoneyInput, type Cents } from "../money";
import { CancellationPolicyError, validateRules, type CancellationRule } from "./cancellation";
import { ItineraryError, parseItinerary, parseLines, type ItineraryDay } from "./itinerary";
import { slugify } from "./slug";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };
type Raw = Record<string, string | undefined>;

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const texto = (valor: string | undefined) => (valor ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const entre = (valor: string, min: number, max: number) => valor.length >= min && valor.length <= max;
const entero = (valor: string, min: number, max: number): number | null =>
  /^\d{1,6}$/.test(valor) && Number(valor) >= min && Number(valor) <= max ? Number(valor) : null;

// ---------------------------------------------------------------------
// Tour
// ---------------------------------------------------------------------
export interface TourInput {
  title: string;
  slug: string;
  summary: string;
  description: string;
  countryCode: string;
  destination: string;
  durationDays: number;
  currency: "USD" | "DOP";
  includes: string[];
  excludes: string[];
  itinerary: ItineraryDay[];
  policyId: string | null;
  published: boolean;
}

export function parseTourForm(raw: Raw): ParseResult<TourInput> {
  const title = texto(raw.title);
  if (!entre(title, 3, 120)) return fail("El título debe tener entre 3 y 120 caracteres");
  const summary = texto(raw.summary);
  if (!entre(summary, 3, 300)) return fail("El resumen debe tener entre 3 y 300 caracteres");
  const description = texto(raw.description);
  if (description.length > 5000) return fail("La descripción no puede superar 5000 caracteres");

  const countryCode = texto(raw.countryCode).toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) return fail("El país debe ser un código de 2 letras (ej. CO, PE, MX)");
  const destination = texto(raw.destination);
  if (!entre(destination, 2, 80)) return fail("El destino debe tener entre 2 y 80 caracteres");

  const durationDays = entero(texto(raw.durationDays), 1, 60);
  if (durationDays === null) return fail("La duración debe ser un número de días entre 1 y 60");
  const currency = texto(raw.currency);
  if (currency !== "USD" && currency !== "DOP") return fail("La moneda debe ser USD o DOP");

  const slug = slugify(texto(raw.slug) || title);
  if (!slug) return fail("No se pudo crear la dirección web: usa un título con letras o números");

  const policyId = texto(raw.policyId);
  if (policyId && !UUID.test(policyId)) return fail("La política de cancelación no es válida");

  try {
    return {
      ok: true,
      value: {
        title, slug, summary, description, countryCode, destination, durationDays, currency,
        includes: parseLines(raw.includes ?? ""),
        excludes: parseLines(raw.excludes ?? ""),
        itinerary: parseItinerary(raw.itinerary ?? ""),
        policyId: policyId || null,
        published: raw.published === "on",
      },
    };
  } catch (error) {
    if (error instanceof ItineraryError) return fail(error.message);
    throw error;
  }
}

// ---------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------
export type DepartureStatusInput = "DRAFT" | "OPEN" | "CLOSED" | "CANCELLED";

export interface DepartureInput {
  tourId: string;
  departsOn: IsoDate;
  returnsOn: IsoDate;
  capacity: number;
  minPassengers: number;
  pricePerPersonCents: Cents;
  singleSupplementCents: Cents | null; // null = no se ofrece habitación individual
  childPriceCents: Cents | null; // null = los niños pagan como adultos
  infantPriceCents: Cents; // 0 = gratis
  childMaxAge: number;
  infantMaxAge: number;
  saleClosesOn: IsoDate;
  supplierDeadline: string; // marca de tiempo UTC
  status: DepartureStatusInput;
  notes: string | null;
}

const ESTADOS: readonly string[] = ["DRAFT", "OPEN", "CLOSED", "CANCELLED"];

export function parseDepartureForm(raw: Raw): ParseResult<DepartureInput> {
  const tourId = texto(raw.tourId);
  if (!UUID.test(tourId)) return fail("El tour no es válido");

  const departsOn = texto(raw.departsOn);
  if (!isIsoDate(departsOn)) return fail("La fecha de salida no es válida");
  const returnsOn = texto(raw.returnsOn);
  if (!isIsoDate(returnsOn)) return fail("La fecha de regreso no es válida");
  if (returnsOn < departsOn) return fail("El regreso no puede ser antes de la salida");
  const saleClosesOn = texto(raw.saleClosesOn);
  if (!isIsoDate(saleClosesOn)) return fail("La fecha de cierre de ventas no es válida");
  if (saleClosesOn > departsOn) return fail("El cierre de ventas no puede ser después de la salida");

  const capacity = entero(texto(raw.capacity), 1, 500);
  if (capacity === null) return fail("El cupo debe ser de 1 a 500 pasajeros");
  const minPassengers = entero(texto(raw.minPassengers), 1, 500);
  if (minPassengers === null) return fail("El mínimo de pasajeros debe ser un número de 1 en adelante");
  if (minPassengers > capacity) return fail("El mínimo de pasajeros no puede superar el cupo");

  const precio = parseMoneyInput(texto(raw.price));
  if (precio === null || precio <= 0) return fail("El precio por persona no es válido (ejemplo: 850.00)");

  // Precios opcionales por habitación y por edad
  const suplemento = texto(raw.singleSupplement);
  const singleSupplementCents = suplemento ? parseMoneyInput(suplemento) : null;
  if (suplemento && singleSupplementCents === null) return fail("El suplemento de habitación individual no es válido (ejemplo: 250.00)");

  const precioNino = texto(raw.childPrice);
  const childPriceCents = precioNino ? parseMoneyInput(precioNino) : null;
  if (precioNino && (childPriceCents === null || childPriceCents <= 0)) return fail("El precio de niño no es válido (ejemplo: 550.00)");

  const precioInfante = texto(raw.infantPrice);
  const infantPriceCents = precioInfante ? parseMoneyInput(precioInfante) : 0;
  if (infantPriceCents === null) return fail("El precio de infante no es válido (ponlo en 0 si viajan gratis)");

  const childMaxAge = entero(texto(raw.childMaxAge) || "11", 2, 17);
  if (childMaxAge === null) return fail("La edad máxima de niño debe estar entre 2 y 17 años");
  const infantMaxAge = entero(texto(raw.infantMaxAge) || "1", 0, 2);
  if (infantMaxAge === null) return fail("La edad máxima de infante debe estar entre 0 y 2 años");
  if (infantMaxAge >= childMaxAge) return fail("La edad máxima de infante debe ser menor que la de niño");

  const supplierDeadline = santoDomingoLocalToIso(texto(raw.supplierDeadline));
  if (!supplierDeadline) return fail("La fecha límite de pago a proveedores es obligatoria (hora de República Dominicana)");

  const status = texto(raw.status) || "DRAFT";
  if (!ESTADOS.includes(status)) return fail("El estado no es válido");
  const notes = texto(raw.notes);
  if (notes.length > 1000) return fail("Las notas no pueden superar 1000 caracteres");

  return {
    ok: true,
    value: {
      tourId, departsOn, returnsOn, capacity, minPassengers, pricePerPersonCents: precio,
      singleSupplementCents, childPriceCents, infantPriceCents, childMaxAge, infantMaxAge, saleClosesOn,
      supplierDeadline, status: status as DepartureStatusInput, notes: notes || null,
    },
  };
}

// ---------------------------------------------------------------------
// Costo por componente
// ---------------------------------------------------------------------
export interface CostItemInput {
  departureId: string;
  supplierId: string | null;
  category: "LODGING" | "TRANSPORT" | "GUIDE" | "ENTRANCE" | "MEAL" | "INSURANCE" | "OTHER";
  description: string;
  currency: string;
  amountCents: Cents;
  fxRateToBase: number;
  basis: "PER_PERSON" | "PER_GROUP";
}

const CATEGORIAS: readonly string[] = ["LODGING", "TRANSPORT", "GUIDE", "ENTRANCE", "MEAL", "INSURANCE", "OTHER"];
const MAX_FX = 1_000_000;

function parseFx(valor: string): number | null {
  if (!/^\d{1,7}(\.\d{1,8})?$/.test(valor)) return null;
  const n = Number(valor);
  return n > 0 && n <= MAX_FX ? n : null;
}

export function parseCostItemForm(raw: Raw, tourCurrency: string): ParseResult<CostItemInput> {
  const departureId = texto(raw.departureId);
  if (!UUID.test(departureId)) return fail("La salida no es válida");
  const supplierId = texto(raw.supplierId);
  if (supplierId && !UUID.test(supplierId)) return fail("El proveedor no es válido");

  const category = texto(raw.category);
  if (!CATEGORIAS.includes(category)) return fail("La categoría no es válida");
  const description = texto(raw.description);
  if (!entre(description, 2, 120)) return fail("La descripción debe tener entre 2 y 120 caracteres");

  const currency = texto(raw.currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return fail("La moneda debe ser un código de 3 letras (ej. USD, COP, PEN, MXN)");
  const amountCents = parseMoneyInput(texto(raw.amount));
  if (amountCents === null) return fail("El monto no es válido (ejemplo: 300,000.00)");

  const basis = texto(raw.basis);
  if (basis !== "PER_PERSON" && basis !== "PER_GROUP") return fail("Indica si el costo es por persona o por grupo");

  // Si el costo está en la misma moneda del tour no hace falta convertir
  let fxRateToBase = 1;
  if (currency !== tourCurrency) {
    const tasa = parseFx(texto(raw.fxRate));
    if (tasa === null) {
      return fail(`Escribe la tasa de cambio: cuánto vale 1 ${currency} en ${tourCurrency} (ej. 0.00025)`);
    }
    fxRateToBase = tasa;
  }

  return {
    ok: true,
    value: {
      departureId, supplierId: supplierId || null, category: category as CostItemInput["category"],
      description, currency, amountCents, fxRateToBase, basis,
    },
  };
}

// ---------------------------------------------------------------------
// Política de cancelación
// ---------------------------------------------------------------------
const REGLA = /^(\d{1,3})\s*(?:d[ií]as?)?\s*[:=\-]\s*(\d{1,3})\s*%?$/i;

// "30 días: 90 %" (una regla por línea) -> reglas
export function parseRulesText(textoReglas: string): CancellationRule[] {
  const lineas = textoReglas.replace(/\r\n/g, "\n").split("\n");
  const reglas: CancellationRule[] = [];
  lineas.forEach((linea, i) => {
    const limpia = linea.trim();
    if (!limpia) return;
    const m = REGLA.exec(limpia);
    if (!m) throw new CancellationPolicyError(`Línea ${i + 1}: usa el formato "30 días: 90 %"`);
    reglas.push({ minDaysBefore: Number(m[1]), refundPercent: Number(m[2]) });
  });
  return reglas;
}

export function formatRulesText(reglas: readonly CancellationRule[]): string {
  return reglas.map((r) => `${r.minDaysBefore} días: ${r.refundPercent} %`).join("\n");
}

export function parsePolicyForm(raw: Raw): ParseResult<{ name: string; rules: CancellationRule[] }> {
  const name = texto(raw.name);
  if (!entre(name, 2, 80)) return fail("El nombre de la política debe tener entre 2 y 80 caracteres");
  try {
    return { ok: true, value: { name, rules: validateRules(parseRulesText(raw.rules ?? "")) } };
  } catch (error) {
    if (error instanceof CancellationPolicyError) return fail(error.message);
    throw error;
  }
}

// ---------------------------------------------------------------------
// Requisitos de entrada por país
// ---------------------------------------------------------------------
export type VisaStatusInput = "UNKNOWN" | "NOT_REQUIRED" | "REQUIRED" | "ON_ARRIVAL" | "E_VISA";

export interface RequirementInput {
  countryCode: string;
  countryName: string;
  passportRequired: boolean;
  visaStatus: VisaStatusInput;
  vaccines: string | null;
  notes: string | null;
  sourceUrl: string | null;
  verifiedAt: IsoDate | null;
}

const VISAS: readonly string[] = ["UNKNOWN", "NOT_REQUIRED", "REQUIRED", "ON_ARRIVAL", "E_VISA"];

export function parseRequirementForm(raw: Raw): ParseResult<RequirementInput> {
  const countryCode = texto(raw.countryCode).toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) return fail("El país debe ser un código de 2 letras (ej. CO, PE, MX)");
  const countryName = texto(raw.countryName);
  if (!entre(countryName, 2, 80)) return fail("El nombre del país debe tener entre 2 y 80 caracteres");

  const visaStatus = texto(raw.visaStatus) || "UNKNOWN";
  if (!VISAS.includes(visaStatus)) return fail("El estado de la visa no es válido");

  const vaccines = texto(raw.vaccines);
  if (vaccines.length > 500) return fail("Las vacunas no pueden superar 500 caracteres");
  const notes = texto(raw.notes);
  if (notes.length > 1000) return fail("Las notas no pueden superar 1000 caracteres");

  const sourceUrl = texto(raw.sourceUrl);
  if (sourceUrl) {
    let valida = false;
    try {
      const url = new URL(sourceUrl);
      valida = url.protocol === "http:" || url.protocol === "https:";
    } catch {
      valida = false;
    }
    if (!valida) return fail("La fuente debe ser un enlace que empiece con http:// o https://");
  }

  const verifiedAt = texto(raw.verifiedAt);
  if (verifiedAt && !isIsoDate(verifiedAt)) return fail("La fecha de verificación no es válida");

  // Nunca se afirma un requisito sin decir de dónde salió ni cuándo se comprobó
  if (visaStatus !== "UNKNOWN" && (!sourceUrl || !verifiedAt)) {
    return fail("Para afirmar los requisitos de visa debes indicar la fuente oficial (enlace) y la fecha en que la verificaste");
  }

  return {
    ok: true,
    value: {
      countryCode, countryName, passportRequired: raw.passportRequired === "on",
      visaStatus: visaStatus as VisaStatusInput, vaccines: vaccines || null, notes: notes || null,
      sourceUrl: sourceUrl || null, verifiedAt: verifiedAt || null,
    },
  };
}
