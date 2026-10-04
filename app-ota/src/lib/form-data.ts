// Convierte un FormData en un objeto de textos. Los archivos se ignoran aquí (se leen aparte, con validación propia).
export function formToRaw(formData: FormData): Record<string, string | undefined> {
  const raw: Record<string, string | undefined> = {};
  for (const [clave, valor] of formData.entries()) {
    if (typeof valor === "string") raw[clave] = valor;
  }
  return raw;
}
