// Datos públicos de la empresa que se muestran en la web.
// Se leen del entorno para no escribir datos reales en el código.
// Si falta el RUT del MITUR, la web dice "en trámite": nunca mostramos una licencia inventada.

const rut = process.env.NEXT_PUBLIC_MITUR_RUT?.trim();
const whatsappDigits = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER?.replace(/\D/g, "");

export const COMPANY = {
  brand: "Dominican OTA Booking",
  miturRut: rut ? rut : null,
  hasWhatsapp: Boolean(whatsappDigits),
  // Para mostrar en documentos: "+18095550100" (o null si no está configurado)
  whatsappDisplay: whatsappDigits ? `+${whatsappDigits}` : null,
} as const;

// Enlace al chat de WhatsApp con un mensaje inicial (null si no hay número configurado)
export function whatsappLink(message: string): string | null {
  if (!whatsappDigits) return null;
  return `https://wa.me/${whatsappDigits}?text=${encodeURIComponent(message)}`;
}
