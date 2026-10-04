// Convierte un título en la parte de la dirección web de un tour: "Medellín: Comuna 13" -> "medellin-comuna-13".

const MAX_SLUG_LENGTH = 80;

export function slugify(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita las tildes (ñ -> n, é -> e)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
}
