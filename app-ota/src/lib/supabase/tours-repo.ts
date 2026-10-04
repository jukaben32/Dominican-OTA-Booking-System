import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { validateRules, type CancellationRule } from "../tours/cancellation";

// Lecturas del catálogo de tours. Cada función recibe el cliente que corresponde:
//   - paneles de administración y de agentes: el cliente CON SESIÓN (la seguridad por filas decide qué ve cada quien),
//   - páginas públicas: el cliente de servidor, pero SOLO con columnas explícitas y tours publicados
//     (nunca se exponen costos, márgenes ni estado interno).

const DEPARTURE_SELECT =
  "id, tour_id, departs_on, returns_on, capacity, min_passengers, price_per_person_cents, single_supplement_cents, child_price_cents, infant_price_cents, child_max_age, infant_max_age, sale_closes_on, supplier_deadline, status, notes";

const itinerarySchema = z.array(z.object({ day: z.number(), title: z.string(), description: z.string() }));

const tourColumns =
  "id, slug, title, summary, description, country_code, destination, duration_days, currency, includes, excludes, itinerary, cover_path, gallery_paths, cancellation_policy_id, published";

const tourRow = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  description: z.string(),
  country_code: z.string(),
  destination: z.string(),
  duration_days: z.number(),
  currency: z.enum(["USD", "DOP"]),
  includes: z.array(z.string()),
  excludes: z.array(z.string()),
  itinerary: itinerarySchema,
  cover_path: z.string().nullable(),
  gallery_paths: z.array(z.string()),
  cancellation_policy_id: z.string().nullable(),
  published: z.boolean(),
});
export type TourRow = z.infer<typeof tourRow>;

const departureRow = z.object({
  id: z.string(),
  tour_id: z.string(),
  departs_on: z.string(),
  returns_on: z.string(),
  capacity: z.number(),
  min_passengers: z.number(),
  price_per_person_cents: z.number(),
  single_supplement_cents: z.number().nullable(),
  child_price_cents: z.number().nullable(),
  infant_price_cents: z.number(),
  child_max_age: z.number(),
  infant_max_age: z.number(),
  sale_closes_on: z.string(),
  supplier_deadline: z.string(),
  status: z.enum(["DRAFT", "OPEN", "CLOSED", "CANCELLED"]),
  notes: z.string().nullable(),
});
export type DepartureRow = z.infer<typeof departureRow>;
export type DepartureWithSeats = DepartureRow & { taken: number };

function fallo(que: string, error: { message: string }): never {
  throw new Error(`No se pudo leer ${que}: ${error.message}`);
}

// Pasajeros ya reservados de cada salida (una llamada por salida; son pocas)
async function conCupos(db: SupabaseClient, salidas: DepartureRow[]): Promise<DepartureWithSeats[]> {
  return Promise.all(
    salidas.map(async (s) => {
      const { data, error } = await db.rpc("departure_seats_taken", { p_departure: s.id });
      if (error) fallo("los cupos", error);
      return { ...s, taken: Number(data ?? 0) };
    }),
  );
}

export async function listTours(db: SupabaseClient): Promise<TourRow[]> {
  const { data, error } = await db.from("tours").select(tourColumns).order("created_at", { ascending: false });
  if (error) fallo("los tours", error);
  return z.array(tourRow).parse(data ?? []);
}

export async function getTour(db: SupabaseClient, id: string): Promise<TourRow | null> {
  const { data, error } = await db.from("tours").select(tourColumns).eq("id", id).maybeSingle();
  if (error) fallo("el tour", error);
  return data ? tourRow.parse(data) : null;
}

export async function listDepartures(db: SupabaseClient, tourId: string): Promise<DepartureWithSeats[]> {
  const { data, error } = await db.from("tour_departures").select(DEPARTURE_SELECT).eq("tour_id", tourId).order("departs_on");
  if (error) fallo("las salidas", error);
  return conCupos(db, z.array(departureRow).parse(data ?? []));
}

export async function getDeparture(db: SupabaseClient, id: string): Promise<DepartureWithSeats | null> {
  const { data, error } = await db.from("tour_departures").select(DEPARTURE_SELECT).eq("id", id).maybeSingle();
  if (error) fallo("la salida", error);
  if (!data) return null;
  return (await conCupos(db, [departureRow.parse(data)]))[0];
}

// Salidas con venta abierta o próximas, con el tour al que pertenecen (pantalla de ventas de los agentes)
export async function listSellableDepartures(db: SupabaseClient, today: string) {
  const { data, error } = await db
    .from("tour_departures")
    .select(`${DEPARTURE_SELECT}, tour:tours!inner(title, slug, destination, country_code, currency, duration_days)`)
    .in("status", ["OPEN"])
    .gte("sale_closes_on", today)
    .order("departs_on");
  if (error) fallo("las salidas", error);

  const filas = z
    .array(
      departureRow.extend({
        tour: z.object({
          title: z.string(), slug: z.string(), destination: z.string(), country_code: z.string(),
          currency: z.enum(["USD", "DOP"]), duration_days: z.number(),
        }),
      }),
    )
    .parse(data ?? []);

  const cupos = await conCupos(db, filas);
  return filas.map((f, i) => ({ ...f, taken: cupos[i].taken }));
}

const costRow = z.object({
  id: z.string(),
  departure_id: z.string(),
  supplier_id: z.string().nullable(),
  category: z.string(),
  description: z.string(),
  currency: z.string(),
  amount_cents: z.number(),
  fx_rate_to_base: z.number(),
  basis: z.enum(["PER_PERSON", "PER_GROUP"]),
});
export type CostItemRow = z.infer<typeof costRow>;

// Solo un administrador recibe filas (la seguridad por filas oculta los costos a los agentes)
export async function listCostItems(db: SupabaseClient, departureId: string): Promise<CostItemRow[]> {
  const { data, error } = await db
    .from("tour_cost_items")
    .select("id, departure_id, supplier_id, category, description, currency, amount_cents, fx_rate_to_base, basis")
    .eq("departure_id", departureId)
    .order("created_at");
  if (error) fallo("los costos", error);
  return z.array(costRow).parse(data ?? []);
}

const policyRow = z.object({ id: z.string(), name: z.string(), rules: z.unknown() });
export interface PolicyRow {
  id: string;
  name: string;
  rules: CancellationRule[];
}

export async function listPolicies(db: SupabaseClient): Promise<PolicyRow[]> {
  const { data, error } = await db.from("cancellation_policies").select("id, name, rules").order("name");
  if (error) fallo("las políticas", error);
  return z
    .array(policyRow)
    .parse(data ?? [])
    .map((p) => ({ id: p.id, name: p.name, rules: validateRules(p.rules) }));
}

const requirementRow = z.object({
  country_code: z.string(),
  country_name: z.string(),
  passport_required: z.boolean(),
  visa_status: z.enum(["UNKNOWN", "NOT_REQUIRED", "REQUIRED", "ON_ARRIVAL", "E_VISA"]),
  vaccines: z.string().nullable(),
  notes: z.string().nullable(),
  source_url: z.string().nullable(),
  verified_at: z.string().nullable(),
});
export type RequirementRow = z.infer<typeof requirementRow>;

const requirementColumns = "country_code, country_name, passport_required, visa_status, vaccines, notes, source_url, verified_at";

export async function listRequirements(db: SupabaseClient): Promise<RequirementRow[]> {
  const { data, error } = await db.from("destination_requirements").select(requirementColumns).order("country_name");
  if (error) fallo("los requisitos", error);
  return z.array(requirementRow).parse(data ?? []);
}

export async function getRequirement(db: SupabaseClient, countryCode: string): Promise<RequirementRow | null> {
  const { data, error } = await db.from("destination_requirements").select(requirementColumns).eq("country_code", countryCode).maybeSingle();
  if (error) fallo("los requisitos", error);
  return data ? requirementRow.parse(data) : null;
}

export async function listSuppliers(db: SupabaseClient): Promise<{ id: string; name: string; kind: string }[]> {
  const { data, error } = await db.from("suppliers").select("id, name, kind").eq("active", true).order("name");
  if (error) fallo("los proveedores", error);
  return z.array(z.object({ id: z.string(), name: z.string(), kind: z.string() })).parse(data ?? []);
}

// ---------------------------------------------------------------------
// Lecturas PÚBLICAS: solo tours publicados y columnas seguras
// ---------------------------------------------------------------------
export interface PublicTour extends Omit<TourRow, "published" | "cancellation_policy_id"> {
  policyRules: CancellationRule[] | null;
  departures: PublicDeparture[];
}

// Sin supplier_deadline ni notes: son datos internos que nunca deben llegar a una página pública
const publicDepartureSelect =
  "id, tour_id, departs_on, returns_on, capacity, min_passengers, price_per_person_cents, single_supplement_cents, child_price_cents, infant_price_cents, child_max_age, infant_max_age, sale_closes_on, status";
const publicDepartureRow = departureRow.omit({ supplier_deadline: true, notes: true });
export type PublicDeparture = z.infer<typeof publicDepartureRow> & { taken: number };

async function hidratarPublico(db: SupabaseClient, tour: TourRow, hoy: string): Promise<PublicTour> {
  const { data, error } = await db
    .from("tour_departures")
    .select(publicDepartureSelect)
    .eq("tour_id", tour.id)
    .eq("status", "OPEN")
    .gte("sale_closes_on", hoy)
    .order("departs_on");
  if (error) fallo("las salidas", error);

  let policyRules: CancellationRule[] | null = null;
  if (tour.cancellation_policy_id) {
    const { data: politica } = await db.from("cancellation_policies").select("rules").eq("id", tour.cancellation_policy_id).maybeSingle();
    if (politica) policyRules = validateRules(politica.rules);
  }

  const { published: _p, cancellation_policy_id: _c, ...publico } = tour;
  void _p;
  void _c;
  const filas = z.array(publicDepartureRow).parse(data ?? []);
  const cupos = await Promise.all(
    filas.map(async (f) => {
      const { data: tomados, error: errorCupos } = await db.rpc("departure_seats_taken", { p_departure: f.id });
      if (errorCupos) fallo("los cupos", errorCupos);
      return { ...f, taken: Number(tomados ?? 0) };
    }),
  );
  return { ...publico, policyRules, departures: cupos };
}

export async function listPublishedTours(db: SupabaseClient, hoy: string): Promise<PublicTour[]> {
  const { data, error } = await db.from("tours").select(tourColumns).eq("published", true).order("created_at", { ascending: false });
  if (error) fallo("los tours", error);
  return Promise.all(z.array(tourRow).parse(data ?? []).map((t) => hidratarPublico(db, t, hoy)));
}

export async function getPublishedTourBySlug(db: SupabaseClient, slug: string, hoy: string): Promise<PublicTour | null> {
  const { data, error } = await db.from("tours").select(tourColumns).eq("slug", slug).eq("published", true).maybeSingle();
  if (error) fallo("el tour", error);
  return data ? hidratarPublico(db, tourRow.parse(data), hoy) : null;
}

export async function getVerifiedRequirement(db: SupabaseClient, countryCode: string): Promise<RequirementRow | null> {
  const r = await getRequirement(db, countryCode);
  // Solo se muestra al público lo que tiene fuente y fecha de verificación
  return r && r.visa_status !== "UNKNOWN" && r.verified_at ? r : null;
}

