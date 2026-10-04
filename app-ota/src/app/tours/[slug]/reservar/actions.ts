"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/components/action-form";
import { getOnlineEnv } from "@/lib/env";
import { logError } from "@/lib/logger";
import { attemptKey, clientIp, deriveAccessToken } from "@/lib/online/access-token";
import { normalizePhone } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/admin";
import { takeAttempt } from "@/lib/supabase/online-repo";
import { passengersForRpc, prepareTourSale } from "@/lib/supabase/tour-sale";

const HOLD_HOURS = 48; // el cupo se guarda 48 horas mientras el cliente paga
const MAX_BY_IP = 6; // intentos de reserva por IP por hora
const WINDOW_MINUTES = 60;

const schema = z.object({
  formToken: z.uuid(),
  departureId: z.uuid(),
  customerName: z.string().trim().min(2, "Escribe tu nombre completo").max(120),
  phone: z.string().max(40),
  email: z.union([z.literal(""), z.email("El correo no es válido").max(254)]),
  consent: z.literal(true, { error: "Debes aceptar la política de privacidad y las condiciones para reservar" }),
  website: z.string().max(200), // trampa para robots: una persona nunca lo llena
});

// Errores de la función SQL -> mensajes claros y seguros para el público
const ERRORES_SQL: [string, string][] = [
  ["CUPO_AGOTADO", "Ya no quedan cupos suficientes en esta salida"],
  ["VENTA_CERRADA", "La venta de esta salida ya cerró"],
  ["SALIDA_NO_DISPONIBLE", "Esta salida no está disponible para reservar en línea"],
  ["SALIDA_NO_EXISTE", "Esta salida no existe"],
  ["PASAJEROS_INVALIDOS", "Revisa los pasajeros: de 1 a 9, con nombre completo"],
  ["EDAD_NO_COINCIDE", "La edad de un pasajero no coincide con su tipo (adulto, niño o infante)"],
  ["FALTA_FECHA_NACIMIENTO", "Los niños y los infantes necesitan fecha de nacimiento"],
  ["FECHA_NACIMIENTO_INVALIDA", "Una fecha de nacimiento no es válida"],
  ["HABITACION_INDIVIDUAL_NO_DISPONIBLE", "Esta salida no ofrece habitación individual"],
  ["HABITACION_INVALIDA", "La habitación individual solo aplica a adultos"],
  ["SIN_ADULTOS", "Debe viajar al menos un adulto"],
  ["INFANTES_SIN_ADULTO", "Cada infante necesita un adulto"],
  ["TOTAL_NO_COINCIDE", "El precio de la salida cambió: recarga la página e inténtalo de nuevo"],
  ["DATOS_CLIENTE_INVALIDOS", "Revisa tu nombre y tu correo"],
  // Mensajes que no revelan si un teléfono ajeno tiene reservas abiertas
  ["DEMASIADAS_RESERVAS_ABIERTAS", "No pudimos crear la reserva en línea. Escríbenos por WhatsApp y te ayudamos"],
  ["DEMASIADOS_CUPOS_RETENIDOS", "Por ahora no podemos guardar más cupos sin pago en esta salida. Inténtalo más tarde o escríbenos por WhatsApp"],
];

const ERROR_GENERICO = "No se pudo completar la reserva. Inténtalo de nuevo o escríbenos por WhatsApp";

// Reserva en línea: cualquier visitante puede ejecutarla, por eso NADA viene de confianza del formulario:
// el precio, las edades y el cupo los vuelve a calcular el servidor y los verifica la base de datos.
export async function createOnlineBookingAction(_anterior: ActionState, formData: FormData): Promise<ActionState> {
  const datos = schema.safeParse({
    formToken: formData.get("formToken"),
    departureId: formData.get("departureId"),
    customerName: formData.get("customerName") ?? "",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    consent: formData.get("consent") === "on",
    website: formData.get("website") ?? "",
  });
  if (!datos.success) return { error: datos.error.issues[0]?.message ?? "Revisa los datos del formulario" };
  const d = datos.data;
  if (d.website !== "") return { error: ERROR_GENERICO }; // robot: sin pistas sobre qué falló

  const telefono = normalizePhone(d.phone);
  if (!telefono) return { error: "El teléfono no es válido. Ejemplos: 809-555-0100 o +1 305 555 0100" };

  const admin = createAdminClient();
  try {
    // Solo se limita por IP: limitar por teléfono dejaba a un atacante bloquear a una víctima escribiendo su número
    const ip = clientIp(await headers());
    if (ip && !(await takeAttempt(admin, attemptKey("reserva-ip", ip), MAX_BY_IP, WINDOW_MINUTES))) {
      return { error: "Demasiados intentos. Espera un rato o escríbenos por WhatsApp" };
    }
  } catch (error) {
    logError("online.rate_limit_failed", error);
    return { error: ERROR_GENERICO };
  }

  const venta = await prepareTourSale(admin, d.departureId, formData);
  if (!venta.ok) {
    if (venta.kind === "interno") return { error: ERROR_GENERICO }; // el detalle ya quedó en el registro
    return { error: venta.error };
  }

  // El enlace privado se calcula con el identificador del formulario: reenviar el mismo formulario da el mismo enlace
  const enlace = deriveAccessToken(d.formToken, getOnlineEnv().ONLINE_LINK_SECRET);

  const { data, error } = await admin.rpc("create_tour_booking", {
    p_actor: null,
    p_form_token: d.formToken,
    p_departure_id: d.departureId,
    p_customer_name: d.customerName,
    p_phone: telefono,
    p_email: d.email,
    p_whatsapp_opt_in: false, // el consentimiento de WhatsApp lo confirma un agente, no un formulario web
    p_passengers: passengersForRpc(venta.passengers),
    p_supplier_cost_cents: venta.split.supplierCostCents,
    p_service_fee_cents: venta.split.serviceFeeCents,
    p_itbis_cents: venta.split.itbisCents,
    p_source: "ONLINE",
    p_access_token_hash: enlace.hash,
    p_hold_hours: HOLD_HOURS,
  });

  if (error || typeof data !== "string") {
    const conocido = ERRORES_SQL.find(([codigo]) => error?.message.includes(codigo));
    if (conocido) return { error: conocido[1] };
    logError("online.rpc_failed", error ?? new Error("respuesta inesperada"), { departureId: d.departureId });
    return { error: ERROR_GENERICO };
  }

  redirect(`/mi-reserva/${enlace.token}`);
}
