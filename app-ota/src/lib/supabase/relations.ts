import { z } from "zod";

// PostgREST devuelve una relación uno-a-uno (ej. reserva -> plan, porque booking_id es único) como OBJETO o null,
// y una relación uno-a-muchos como lista. Este esquema acepta las dos formas y siempre entrega una lista.
export function zeroOrMany<T extends z.ZodType>(item: T) {
  return z
    .union([z.array(item), item, z.null()])
    .transform((v): z.infer<T>[] => (v === null ? [] : Array.isArray(v) ? v : [v]));
}
