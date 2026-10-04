import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InboundStore, MessageStatus } from "../../services/inbound-service";

const UNIQUE_VIOLATION = "23505";
const OPEN_LEAD_STATUSES = ["NEW", "IN_PROGRESS", "QUOTED"];

export function createSupabaseInboundStore(db: SupabaseClient): InboundStore {
  return {
    async claimWebhookEvent(provider, eventId) {
      const { error } = await db.from("processed_webhooks").insert({ provider, event_id: eventId });
      if (!error) return true;
      if (error.code === UNIQUE_VIOLATION) return false;
      throw new Error(`No se pudo registrar el evento: ${error.message}`);
    },

    async releaseWebhookEvent(provider, eventId) {
      await db.from("processed_webhooks").delete().eq("provider", provider).eq("event_id", eventId);
    },

    async upsertCustomer(phone, name) {
      const buscar = async () =>
        db.from("customers").select("id").eq("phone_e164", phone).maybeSingle();

      const { data: existente, error } = await buscar();
      if (error) throw new Error(`No se pudo buscar el cliente: ${error.message}`);
      if (existente) return { id: existente.id as string, created: false };

      const { data, error: errorInsert } = await db
        .from("customers")
        .insert({ phone_e164: phone, full_name: name?.trim() || phone })
        .select("id")
        .single();

      if (errorInsert?.code === UNIQUE_VIOLATION) {
        const { data: carrera } = await buscar();
        if (carrera) return { id: carrera.id as string, created: false };
      }
      if (errorInsert || !data) throw new Error(`No se pudo crear el cliente: ${errorInsert?.message ?? "sin datos"}`);
      return { id: data.id as string, created: true };
    },

    async hasOpenLead(customerId) {
      const { count, error } = await db
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customerId)
        .in("status", OPEN_LEAD_STATUSES);
      if (error) throw new Error(`No se pudo leer los leads: ${error.message}`);
      return (count ?? 0) > 0;
    },

    async createLead(customerId, summary) {
      const { error } = await db
        .from("leads")
        .insert({ customer_id: customerId, source: "WHATSAPP", trip_summary: summary });
      if (error) throw new Error(`No se pudo crear el lead: ${error.message}`);
    },

    async logInboundMessage({ customerId, providerMessageId, preview }) {
      const { error } = await db.from("whatsapp_messages").insert({
        customer_id: customerId,
        direction: "IN",
        provider_message_id: providerMessageId,
        body_preview: preview,
        status: "RECEIVED",
      });
      // Si ya estaba registrado (reintento), no es un error
      if (error && error.code !== UNIQUE_VIOLATION) {
        throw new Error(`No se pudo guardar el mensaje: ${error.message}`);
      }
    },

    async getOutboundStatus(providerMessageId) {
      const { data, error } = await db
        .from("whatsapp_messages")
        .select("status")
        .eq("provider_message_id", providerMessageId)
        .eq("direction", "OUT")
        .maybeSingle();
      if (error) throw new Error(`No se pudo leer el mensaje: ${error.message}`);
      return (data?.status as MessageStatus | undefined) ?? null;
    },

    async updateOutboundStatus(providerMessageId, status, error) {
      const { error: errorUpdate } = await db
        .from("whatsapp_messages")
        .update({ status, error: error ?? null })
        .eq("provider_message_id", providerMessageId);
      if (errorUpdate) throw new Error(`No se pudo actualizar el mensaje: ${errorUpdate.message}`);
    },
  };
}
