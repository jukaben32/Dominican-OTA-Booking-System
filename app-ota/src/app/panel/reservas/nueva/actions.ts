"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth";
import { santoDomingoLocalToIso } from "@/lib/dates";
import { logError } from "@/lib/logger";
import { parseMoneyInput } from "@/lib/money";
import { normalizePhone } from "@/lib/phone";
import { buildQuote } from "@/lib/pricing";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/components/action-form";

const MAX_PASSENGERS = 9;
const IATA = /^[A-Za-z]{3}$/;

// Texto opcional de un formulario: "" -> undefined
const texto = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? undefined : v))
    .optional();

const schema = z.object({
  formToken: z.uuid(),
  customerName: z.string().trim().min(2, "Escribe el nombre del cliente").max(120),
  phone: z.string(),
  email: z.union([z.literal(""), z.email("El correo no es válido").max(254)]),
  whatsappOptIn: z.boolean(),
  productType: z.enum(["FLIGHT", "HOTEL", "PACKAGE", "INSURANCE", "TRANSFER", "GROUP_SEAT"]),
  currency: z.enum(["USD", "DOP"]),
  supplierCost: z.string(),
  serviceFee: z.string(),
  priceGuaranteed: z.boolean(),
  supplierDeadline: texto(30),
  passengers: z.string(),
  airline: texto(60),
  origin: texto(3),
  destination: texto(3),
  departs: texto(30),
});

export async function createBookingAction(_anterior: ActionState, formData: FormData): Promise<ActionState> {
  await requireStaff(); // solo exige ser personal; quién crea la reserva lo toma la función SQL del token de sesión

  const datos = schema.safeParse({
    formToken: formData.get("formToken"),
    customerName: formData.get("customerName") ?? "",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    whatsappOptIn: formData.get("whatsappOptIn") === "on",
    productType: formData.get("productType"),
    currency: formData.get("currency"),
    supplierCost: formData.get("supplierCost") ?? "",
    serviceFee: formData.get("serviceFee") ?? "",
    priceGuaranteed: formData.get("priceGuaranteed") === "on",
    supplierDeadline: formData.get("supplierDeadline") ?? "",
    passengers: formData.get("passengers") ?? "",
    airline: formData.get("airline") ?? "",
    origin: formData.get("origin") ?? "",
    destination: formData.get("destination") ?? "",
    departs: formData.get("departs") ?? "",
  });
  if (!datos.success) return { error: datos.error.issues[0]?.message ?? "Revisa los datos del formulario" };
  const d = datos.data;

  const telefono = normalizePhone(d.phone);
  if (!telefono) return { error: "El teléfono no es válido. Ejemplos: 809-555-0100 o +34 612 345 678" };

  const costo = parseMoneyInput(d.supplierCost);
  if (costo === null) return { error: "El costo del proveedor no es un monto válido (ejemplo: 450.00)" };
  const cargo = parseMoneyInput(d.serviceFee);
  if (cargo === null) return { error: "El cargo por servicio no es un monto válido (ejemplo: 30.00)" };
  if (costo + cargo === 0) return { error: "El total de la reserva no puede ser cero" };

  const pasajeros = d.passengers
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (pasajeros.length === 0) return { error: "Escribe al menos un pasajero (nombre como aparece en el pasaporte)" };
  if (pasajeros.length > MAX_PASSENGERS) return { error: `Máximo ${MAX_PASSENGERS} pasajeros por reserva` };
  if (pasajeros.some((p) => p.length < 2 || p.length > 100)) return { error: "Cada nombre de pasajero debe tener entre 2 y 100 letras" };

  let venceProveedor: string | null = null;
  if (d.supplierDeadline) {
    venceProveedor = santoDomingoLocalToIso(d.supplierDeadline);
    if (!venceProveedor) return { error: "La fecha de vencimiento del proveedor no es válida" };
  }

  // Tramo de vuelo: opcional, pero si se llena una parte deben estar todas
  const hayTramo = Boolean(d.origin || d.destination || d.departs || d.airline);
  let salida: string | null = null;
  if (hayTramo) {
    if (!d.origin || !IATA.test(d.origin) || !d.destination || !IATA.test(d.destination) || !d.airline || !d.departs) {
      return { error: "Para el tramo de vuelo completa aerolínea, origen, destino (3 letras, ej. JFK) y fecha de salida" };
    }
    salida = santoDomingoLocalToIso(d.departs);
    if (!salida) return { error: "La fecha de salida no es válida" };
  }

  const cotizacion = buildQuote({ supplierCostCents: costo, serviceFeeCents: cargo, currency: d.currency });
  const db = await createClient(); // con la sesión del agente: la función SQL verifica que sea personal

  // Una sola llamada transaccional: cliente + reserva + pasajeros + vuelo, o nada. El token del formulario
  // evita duplicados si se reenvía. La base de datos exige además que el ITBIS sea el 18 % exacto del cargo.
  const { data, error } = await db.rpc("create_booking", {
    p_form_token: d.formToken,
    p_customer_name: d.customerName,
    p_phone: telefono,
    p_email: d.email,
    p_whatsapp_opt_in: d.whatsappOptIn,
    p_product_type: d.productType,
    p_currency: d.currency,
    p_supplier_cost_cents: cotizacion.supplierCostCents,
    p_service_fee_cents: cotizacion.serviceFeeCents,
    p_itbis_cents: cotizacion.itbisCents,
    p_price_guaranteed: d.priceGuaranteed,
    p_supplier_deadline: venceProveedor,
    p_passengers: pasajeros,
    p_segment:
      salida && d.origin && d.destination && d.airline
        ? { airline: d.airline, origin: d.origin, dest: d.destination, departs_at: salida }
        : null,
  });

  if (error || typeof data !== "string") {
    logError("panel.create_booking.failed", error ?? new Error("respuesta inesperada"));
    return { error: "No se pudo guardar la reserva. Inténtalo de nuevo; si persiste, avisa a un administrador" };
  }
  const reservaId = data;

  // redirect() lanza una excepción especial: va fuera del try/catch
  redirect(`/panel/reservas/${reservaId}`);
}
