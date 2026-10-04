// Lectura segura del cuerpo de una petición pública (webhooks).
// Un atacante anónimo puede mandar cuerpos gigantes para agotar la memoria: por eso se corta en cuanto
// se pasa del límite, SIN llegar a leerlo completo. El límite se mide en BYTES, no en caracteres.

// Devuelve el texto del cuerpo, o null si supera maxBytes.
export async function readBodyLimited(request: Request, maxBytes: number): Promise<string | null> {
  const declarado = Number(request.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > maxBytes) return null;

  if (!request.body) return "";

  const lector = request.body.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await lector.cancel(); // dejamos de recibir
      return null;
    }
    trozos.push(value);
  }

  const completo = new Uint8Array(total);
  let posicion = 0;
  for (const t of trozos) {
    completo.set(t, posicion);
    posicion += t.byteLength;
  }
  return new TextDecoder().decode(completo);
}
