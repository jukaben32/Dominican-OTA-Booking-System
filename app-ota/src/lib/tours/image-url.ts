// Dirección pública de una foto de tour. El bucket "tour-images" es público de solo lectura.
export function tourImageUrl(path: string | null | undefined): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!path || !base) return null;
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/tour-images/${path}`;
}
