"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/components/action-form";
import { requireStaff } from "@/lib/auth";
import { logError } from "@/lib/logger";
import { normalizePhone } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/admin";
import { passengersForRpc, prepareTourSale } from "@/lib/supabase/tour-sale";

const schema = z.object({
  formToken: z.uuid(),
  departureId: z.uuid(),
  customerName: z.string().trim().min(2, "Escribe el nombre del cliente").max(120),
  phone: z.string(),
  email: z.union([z.literal(""), z.email("El correo no es válido").max(254)]),
  whatsappOptIn: z.boolean(),
});

// Errores de la función SQL -> mensajes claros para el agente
const ERRORES_SQL: [string, string][] = [
  ["CUPO_AGOTADO", "No quedan suficientes cupos en esta salida"],
  ["VENTA_CERRADA", "La venta de esta salida ya cerró"],
  ["SALIDA_NO_DISPONIBLE", "Esta salida no está abierta a la venta"],
  ["SALIDA_NO_EXISTE", "La salida no existe"],
  ["PASAJEROS_INVALIDOS", "Revisa los pasajeros: de 1 a 9, con nombre completo"],
  ["EDAD_NO_COINCIDE", "La edad de un pasajero no coincide con su tipo (adulto, niño o infante)"],
  ["FALTA_FECHA_NACIMIENTO", "Los niños y los infantes necesitan fecha de nacimiento"],
  ["FECHA_NACIMIENTO_INVALIDA", "Una fecha de nacimiento no es válida"],
  ["HABITACION_INDIVIDUAL_NO_DISPONIBLE", "Esta salida no ofrece habitación individual"],
  ["HABITACION_INVALIDA", "La habitación individual solo aplica a adultos"],
  ["SIN_ADULTOS", "Debe viajar al menos un adulto"],
  ["INFANTES_SIN_ADULTO", "Cada infante necesita un adulto"],
  ["TOTAL_NO_COINCIDE", "El precio de la salida cambió: recarga la página e inténtalo de nuevo"],
  ["NO_AUTORIZADO", "No tienes permiso para vender"],
  ["DATOS_CLIENTE_INVALIDOS", "Revisa el nombre y el correo del cliente"],
];

// Vende una salida: calcula el reparto del precio EN EL SERVIDOR (el agente nunca ve los costos) y crea la reserva
export async function sellDepartureAction(_anterior: ActionState, formData: FormData): Promise<ActionState> {
  const usuario = await requireStaff();

  const datos = schema.safeParse({
    formToken: formData.get("formToken"),
    departureId: formData.get("departureId"),
    customerName: formData.get("customerName") ?? "",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    whatsappOptIn: formData.get("whatsappOptIn") === "on",
  });
  if (!datos.success) return { error: datos.error.issues[0]?.message ?? "Revisa los datos del formulario" };
  const d = datos.data;

  const telefono = normalizePhone(d.phone);
  if (!telefono) return { error: "El teléfono no es válido. Ejemplos: 809-555-0100 o +34 612 345 678" };

  // Lectura con la llave de servicio SOLO para calcular el reparto: los costos no se muestran al agente
  const admin = createAdminClient();
  const venta = await prepareTourSale(admin, d.departureId, formData);
  if (!venta.ok) return { error: venta.error };
  const reparto = venta.split;

  // La función solo la puede ejecutar el servidor (un agente no puede inventar el reparto del precio llamándola directo):
  // aquí ya verificamos la sesión con requireStaff() y le indicamos quién vende.
  const { data, error } = await admin.rpc("create_tour_booking", {
    p_actor: usuario.id,
    p_form_token: d.formToken,
    p_departure_id: d.departureId,
    p_customer_name: d.customerName,
    p_phone: telefono,
    p_email: d.email,
    p_whatsapp_opt_in: d.whatsappOptIn,
    p_passengers: passengersForRpc(venta.passengers),
    p_supplier_cost_cents: reparto.supplierCostCents,
    p_service_fee_cents: reparto.serviceFeeCents,
    p_itbis_cents: reparto.itbisCents,
  });

  if (error || typeof data !== "string") {
    const conocido = ERRORES_SQL.find(([codigo]) => error?.message.includes(codigo));
    if (conocido) return { error: conocido[1] };
    logError("sell.rpc_failed", error ?? new Error("respuesta inesperada"), { departureId: d.departureId });
    return { error: "No se pudo crear la reserva. Inténtalo de nuevo; si persiste, avisa a un administrador" };
  }

  revalidatePath("/panel/salidas");
  redirect(`/panel/reservas/${data}`);
}
