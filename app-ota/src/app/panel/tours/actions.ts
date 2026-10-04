"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/components/action-form";
import { requireAdmin } from "@/lib/auth";
import { formToRaw } from "@/lib/form-data";
import { validateImageUpload } from "@/lib/images";
import { logError } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseCostItemForm, parseDepartureForm, parseTourForm } from "@/lib/tours/forms";

// Todas las acciones de este archivo son SOLO de administrador: requireAdmin() se llama al inicio de cada una.
// Las escrituras usan la llave de servicio porque la base no deja escribir el catálogo con una sesión normal.

const UNIQUE_VIOLATION = "23505";
const MAX_GALLERY = 6;
const IMAGES_BUCKET = "tour-images";
const idSchema = z.uuid();

// A dónde volver tras una acción: solo a una salida del propio panel (nunca a una dirección arbitraria del formulario)
const RUTA_SALIDA = /^\/panel\/tours\/[0-9a-f-]{36}\/salidas\/[0-9a-f-]{36}$/i;
const destinoSeguro = (valor: unknown): string =>
  typeof valor === "string" && RUTA_SALIDA.test(valor) ? valor : "/panel/tours";

async function auditar(actorId: string, action: string, entity: string, entityId: string, details: Record<string, unknown> = {}) {
  const { error } = await createAdminClient().from("audit_log").insert({ actor_id: actorId, action, entity, entity_id: entityId, details });
  if (error) logError("tours.audit_failed", error, { action });
}

// ---------------------------------------------------------------------
// Tours
// ---------------------------------------------------------------------
function columnasTour(v: Extract<ReturnType<typeof parseTourForm>, { ok: true }>["value"]) {
  return {
    slug: v.slug, title: v.title, summary: v.summary, description: v.description, country_code: v.countryCode,
    destination: v.destination, duration_days: v.durationDays, currency: v.currency, includes: v.includes,
    excludes: v.excludes, itinerary: v.itinerary, cancellation_policy_id: v.policyId, published: v.published,
  };
}

export async function createTourAction(_anterior: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const datos = parseTourForm(formToRaw(formData));
  if (!datos.ok) return { error: datos.error };

  const { data, error } = await createAdminClient()
    .from("tours")
    .insert({ ...columnasTour(datos.value), created_by: admin.id })
    .select("id")
    .single();

  if (error?.code === UNIQUE_VIOLATION) return { error: "Ya existe un tour con esa dirección web. Cambia el título o escribe otra dirección." };
  if (error || !data) {
    logError("tours.create_failed", error ?? new Error("sin datos"));
    return { error: "No se pudo guardar el tour. Inténtalo de nuevo" };
  }
  await auditar(admin.id, "TOUR_CREATED", "tours", data.id as string, { slug: datos.value.slug });
  revalidatePath("/panel/tours");
  redirect(`/panel/tours/${data.id}`);
}

export async function updateTourAction(_anterior: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = idSchema.safeParse(formData.get("tourId"));
  if (!id.success) return { error: "El tour no es válido" };
  const datos = parseTourForm(formToRaw(formData));
  if (!datos.ok) return { error: datos.error };

  const { error } = await createAdminClient().from("tours").update(columnasTour(datos.value)).eq("id", id.data);
  if (error?.code === UNIQUE_VIOLATION) return { error: "Ya existe otro tour con esa dirección web" };
  if (error) {
    logError("tours.update_failed", error, { tourId: id.data });
    return { error: "No se pudo guardar el tour. Inténtalo de nuevo" };
  }
  await auditar(admin.id, "TOUR_UPDATED", "tours", id.data, { published: datos.value.published });
  revalidatePath(`/panel/tours/${id.data}`);
  revalidatePath("/tours");
  redirect(`/panel/tours/${id.data}?guardado=1`);
}

// ---------------------------------------------------------------------
// Fotos (se validan por su CONTENIDO real: JPG, PNG o WebP de hasta 3 MB)
// ---------------------------------------------------------------------
export async function uploadTourImageAction(_anterior: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const tourId = idSchema.safeParse(formData.get("tourId"));
  const tipo = formData.get("kind");
  const archivo = formData.get("file");
  if (!tourId.success || (tipo !== "cover" && tipo !== "gallery")) return { error: "Datos inválidos" };
  if (!(archivo instanceof File) || archivo.size === 0) return { error: "Elige una imagen" };

  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const validacion = validateImageUpload(bytes);
  if (!validacion.ok) return { error: validacion.error };

  const db = createAdminClient();
  const { data: tour, error: errorLectura } = await db.from("tours").select("gallery_paths, cover_path").eq("id", tourId.data).maybeSingle();
  if (errorLectura || !tour) return { error: "El tour no existe" };
  if (tipo === "gallery" && (tour.gallery_paths as string[]).length >= MAX_GALLERY) {
    return { error: `La galería admite como máximo ${MAX_GALLERY} fotos` };
  }

  // El nombre lo ponemos nosotros (nunca el del archivo subido)
  const ruta = `tours/${tourId.data}/${crypto.randomUUID()}.${validacion.ext}`;
  const { error: errorSubida } = await db.storage.from(IMAGES_BUCKET).upload(ruta, bytes, { contentType: validacion.mime, upsert: false });
  if (errorSubida) {
    logError("tours.upload_failed", errorSubida, { tourId: tourId.data });
    return { error: "No se pudo subir la imagen. Inténtalo de nuevo" };
  }

  const cambio = tipo === "cover" ? { cover_path: ruta } : { gallery_paths: [...(tour.gallery_paths as string[]), ruta] };
  const { error } = await db.from("tours").update(cambio).eq("id", tourId.data);
  if (error) {
    await db.storage.from(IMAGES_BUCKET).remove([ruta]); // no dejamos archivos huérfanos
    logError("tours.attach_image_failed", error, { tourId: tourId.data });
    return { error: "No se pudo guardar la imagen en el tour" };
  }
  await auditar(admin.id, "TOUR_IMAGE_ADDED", "tours", tourId.data, { kind: tipo });
  revalidatePath(`/panel/tours/${tourId.data}`);
  redirect(`/panel/tours/${tourId.data}?guardado=1`);
}

export async function removeTourImageAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const tourId = idSchema.safeParse(formData.get("tourId"));
  const ruta = formData.get("path");
  if (!tourId.success || typeof ruta !== "string") redirect("/panel/tours");

  const db = createAdminClient();
  const { data: tour } = await db.from("tours").select("gallery_paths, cover_path").eq("id", tourId.data).maybeSingle();
  // Solo se puede quitar una ruta que realmente pertenece a este tour (no se confía en el formulario)
  if (tour && (tour.cover_path === ruta || (tour.gallery_paths as string[]).includes(ruta))) {
    await db
      .from("tours")
      .update({
        cover_path: tour.cover_path === ruta ? null : tour.cover_path,
        gallery_paths: (tour.gallery_paths as string[]).filter((p) => p !== ruta),
      })
      .eq("id", tourId.data);
    await db.storage.from(IMAGES_BUCKET).remove([ruta]);
    await auditar(admin.id, "TOUR_IMAGE_REMOVED", "tours", tourId.data);
  }
  revalidatePath(`/panel/tours/${tourId.data}`);
  redirect(`/panel/tours/${tourId.data}`);
}

// ---------------------------------------------------------------------
// Salidas
// ---------------------------------------------------------------------
function columnasSalida(v: Extract<ReturnType<typeof parseDepartureForm>, { ok: true }>["value"]) {
  return {
    tour_id: v.tourId, departs_on: v.departsOn, returns_on: v.returnsOn, capacity: v.capacity,
    min_passengers: v.minPassengers, price_per_person_cents: v.pricePerPersonCents,
    single_supplement_cents: v.singleSupplementCents, child_price_cents: v.childPriceCents,
    infant_price_cents: v.infantPriceCents, child_max_age: v.childMaxAge, infant_max_age: v.infantMaxAge,
    sale_closes_on: v.saleClosesOn,
    supplier_deadline: v.supplierDeadline, status: v.status, notes: v.notes,
  };
}

// No se abre la venta de una salida sin costos: el reparto del precio (ITBIS sobre el cargo) depende de ellos
async function sinCostos(departureId: string): Promise<boolean> {
  const { count } = await createAdminClient().from("tour_cost_items").select("id", { count: "exact", head: true }).eq("departure_id", departureId);
  return (count ?? 0) === 0;
}

export async function createDepartureAction(_anterior: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const datos = parseDepartureForm(formToRaw(formData));
  if (!datos.ok) return { error: datos.error };
  if (datos.value.status === "OPEN") return { error: "Crea la salida como borrador, carga sus costos y luego ábrela a la venta" };

  const { data, error } = await createAdminClient().from("tour_departures").insert(columnasSalida(datos.value)).select("id").single();
  if (error?.code === UNIQUE_VIOLATION) return { error: "Ya existe una salida de este tour con esa fecha" };
  if (error || !data) {
    logError("departures.create_failed", error ?? new Error("sin datos"));
    return { error: "No se pudo guardar la salida. Inténtalo de nuevo" };
  }
  await auditar(admin.id, "DEPARTURE_CREATED", "tour_departures", data.id as string, { price: datos.value.pricePerPersonCents });
  revalidatePath(`/panel/tours/${datos.value.tourId}`);
  redirect(`/panel/tours/${datos.value.tourId}/salidas/${data.id}`);
}

export async function updateDepartureAction(_anterior: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = idSchema.safeParse(formData.get("departureId"));
  if (!id.success) return { error: "La salida no es válida" };
  const datos = parseDepartureForm(formToRaw(formData));
  if (!datos.ok) return { error: datos.error };

  const db = createAdminClient();
  const { data: actual } = await db.from("tour_departures").select("status, price_per_person_cents, single_supplement_cents, child_price_cents, infant_price_cents, child_max_age, infant_max_age, capacity").eq("id", id.data).maybeSingle();
  if (!actual) return { error: "La salida no existe" };
  // Cancelar tiene su propio flujo (cancela las reservas y deja los reembolsos pendientes); y no se reabre
  if (datos.value.status === "CANCELLED" && actual.status !== "CANCELLED") return { error: "Para cancelar una salida usa el botón \"Cancelar esta salida\" de más abajo" };
  if (actual.status === "CANCELLED" && datos.value.status !== "CANCELLED") return { error: "Una salida cancelada no se vuelve a abrir: crea una nueva salida" };

  if (datos.value.status === "OPEN" && (await sinCostos(id.data))) {
    return { error: "Antes de abrir la venta carga al menos un costo de esta salida" };
  }

  // Con pasajeros ya vendidos no se puede bajar el cupo por debajo de lo vendido ni cambiar el precio
  const { data: vendidos } = await db.rpc("departure_seats_taken", { p_departure: id.data });
  const tomados = Number(vendidos ?? 0);
  if (datos.value.capacity < tomados) return { error: `Ya hay ${tomados} pasajeros reservados: el cupo no puede ser menor` };
  const preciosCambiaron =
    Number(actual.price_per_person_cents) !== datos.value.pricePerPersonCents ||
    (actual.single_supplement_cents === null ? null : Number(actual.single_supplement_cents)) !== datos.value.singleSupplementCents ||
    (actual.child_price_cents === null ? null : Number(actual.child_price_cents)) !== datos.value.childPriceCents ||
    Number(actual.infant_price_cents) !== datos.value.infantPriceCents ||
    Number(actual.child_max_age) !== datos.value.childMaxAge ||
    Number(actual.infant_max_age) !== datos.value.infantMaxAge;
  if (tomados > 0 && preciosCambiaron) {
    return { error: "Ya hay reservas con los precios actuales: no se pueden cambiar los precios ni las edades de esta salida" };
  }

  // ".neq" cierra la carrera con una cancelación simultánea: una salida cancelada no se vuelve a escribir
  const { data: guardada, error } = await db.from("tour_departures").update(columnasSalida(datos.value)).eq("id", id.data).neq("status", "CANCELLED").select("id");
  if (error?.code === UNIQUE_VIOLATION) return { error: "Ya existe otra salida de este tour con esa fecha" };
  if (error) {
    logError("departures.update_failed", error, { departureId: id.data });
    return { error: "No se pudo guardar la salida. Inténtalo de nuevo" };
  }
  if (!guardada || guardada.length === 0) return { error: "La salida fue cancelada mientras la editabas: ya no se puede modificar" };
  await auditar(admin.id, "DEPARTURE_UPDATED", "tour_departures", id.data, { status: datos.value.status });
  revalidatePath(`/panel/tours/${datos.value.tourId}/salidas/${id.data}`);
  revalidatePath("/tours");
  redirect(`/panel/tours/${datos.value.tourId}/salidas/${id.data}?guardado=1`);
}

// ---------------------------------------------------------------------
// Cancelar una salida (p. ej. no llegó al mínimo): cancela sus reservas y deja los reembolsos pendientes
// ---------------------------------------------------------------------
const cancelSchema = z.object({
  departureId: z.uuid(),
  tourId: z.uuid(),
  reason: z.string().trim().min(3, "Escribe el motivo (mínimo 3 letras)").max(300),
  confirm: z.literal(true, { error: "Marca la casilla para confirmar que entiendes que no se puede deshacer" }),
});

const ERRORES_CANCELAR: [string, string][] = [
  ["YA_CANCELADA", "Esta salida ya estaba cancelada"],
  ["SALIDA_NO_EXISTE", "La salida no existe"],
  ["MOTIVO_INVALIDO", "Escribe el motivo (mínimo 3 letras)"],
  ["NO_AUTORIZADO", "Solo un administrador puede cancelar una salida"],
];

export async function cancelDepartureAction(_anterior: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const datos = cancelSchema.safeParse({
    departureId: formData.get("departureId"),
    tourId: formData.get("tourId"),
    reason: formData.get("reason") ?? "",
    confirm: formData.get("confirm") === "on",
  });
  if (!datos.success) return { error: datos.error.issues[0]?.message ?? "Revisa los datos" };

  const { data, error } = await createAdminClient().rpc("cancel_departure", {
    p_departure: datos.data.departureId,
    p_actor: admin.id,
    p_reason: datos.data.reason,
  });
  if (error) {
    const conocido = ERRORES_CANCELAR.find(([codigo]) => error.message.includes(codigo));
    if (conocido) return { error: conocido[1] };
    logError("departures.cancel_failed", error, { departureId: datos.data.departureId });
    return { error: "No se pudo cancelar la salida. Inténtalo de nuevo" };
  }
  const resumen = data as { cancelled?: number; refunds?: number } | null;
  revalidatePath("/tours");
  revalidatePath("/panel", "layout");
  redirect(`/panel/reembolsos?cancelada=1&reservas=${Number(resumen?.cancelled ?? 0)}&reembolsos=${Number(resumen?.refunds ?? 0)}`);
}

// ---------------------------------------------------------------------
// Costos por componente (confidenciales)
// ---------------------------------------------------------------------
export async function addCostItemAction(_anterior: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const raw = formToRaw(formData);
  const salidaId = idSchema.safeParse(raw.departureId);
  if (!salidaId.success) return { error: "La salida no es válida" };
  // La moneda del tour se lee de la base de datos: un valor manipulado en el formulario falsearía el margen
  const { data: salidaFila } = await createAdminClient().from("tour_departures").select("tour:tours!inner(currency)").eq("id", salidaId.data).maybeSingle();
  const moneda = z.object({ tour: z.object({ currency: z.enum(["USD", "DOP"]) }) }).safeParse(salidaFila);
  if (!moneda.success) return { error: "La salida no existe" };
  const datos = parseCostItemForm(raw, moneda.data.tour.currency);
  if (!datos.ok) return { error: datos.error };

  const v = datos.value;
  const { error } = await createAdminClient().from("tour_cost_items").insert({
    departure_id: v.departureId, supplier_id: v.supplierId, category: v.category, description: v.description,
    currency: v.currency, amount_cents: v.amountCents, fx_rate_to_base: v.fxRateToBase, basis: v.basis,
  });
  if (error) {
    logError("costs.add_failed", error, { departureId: v.departureId });
    return { error: "No se pudo guardar el costo. Inténtalo de nuevo" };
  }
  await auditar(admin.id, "COST_ITEM_ADDED", "tour_departures", v.departureId, { category: v.category });
  revalidatePath("/panel/tours", "layout");
  redirect(destinoSeguro(formData.get("returnTo")));
}

export async function deleteCostItemAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = idSchema.safeParse(formData.get("costId"));
  if (id.success) {
    const { error } = await createAdminClient().from("tour_cost_items").delete().eq("id", id.data);
    if (error) logError("costs.delete_failed", error);
    else await auditar(admin.id, "COST_ITEM_DELETED", "tour_cost_items", id.data);
  }
  revalidatePath("/panel/tours", "layout");
  redirect(destinoSeguro(formData.get("returnTo")));
}
