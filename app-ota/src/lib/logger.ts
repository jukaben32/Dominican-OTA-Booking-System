// Registro de errores del servidor en formato JSON (una línea por evento, fácil de buscar en Vercel).
// REGLA: nunca pasar secretos, cuerpos de webhooks completos ni datos personales (teléfonos, pasaportes).

// Los errores de Supabase son objetos con "message" (no instancias de Error): también los leemos
function mensajeDe(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "error desconocido";
}

export function logError(event: string, error: unknown, context: Record<string, string | number> = {}): void {
  console.error(JSON.stringify({ level: "error", event, message: mensajeDe(error), ...context }));
}
