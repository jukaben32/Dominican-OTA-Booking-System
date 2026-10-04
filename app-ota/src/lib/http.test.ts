import { describe, expect, test } from "vitest";
import { readBodyLimited } from "./http";

function peticion(cuerpo: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request("https://ejemplo.test/webhook", { method: "POST", body: cuerpo, headers });
}

// Cuerpo en trozos SIN Content-Length (como una petición "chunked")
function enTrozos(trozos: string[]): Request {
  const flujo = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const t of trozos) controller.enqueue(enc.encode(t));
      controller.close();
    },
  });
  return new Request("https://ejemplo.test/webhook", {
    method: "POST",
    body: flujo,
    // @ts-expect-error: "duplex" es necesario en Node para enviar un stream
    duplex: "half",
  });
}

describe("readBodyLimited", () => {
  test("lee un cuerpo pequeño completo", async () => {
    expect(await readBodyLimited(peticion('{"a":1}'), 100)).toBe('{"a":1}');
  });

  test("devuelve texto vacío si no hay cuerpo", async () => {
    expect(await readBodyLimited(peticion(null), 100)).toBe("");
  });

  test("rechaza de inmediato si Content-Length declara más del límite (sin leer el cuerpo)", async () => {
    const req = peticion("x", { "content-length": "999999" });
    expect(await readBodyLimited(req, 100)).toBeNull();
  });

  test("rechaza un cuerpo en trozos que supera el límite aunque no declare tamaño", async () => {
    expect(await readBodyLimited(enTrozos(["a".repeat(60), "b".repeat(60)]), 100)).toBeNull();
  });

  test("acepta un cuerpo en trozos que cabe en el límite", async () => {
    expect(await readBodyLimited(enTrozos(["hola ", "mundo"]), 100)).toBe("hola mundo");
  });

  test("cuenta BYTES, no caracteres (la ñ pesa 2 bytes)", async () => {
    // 60 "ñ" son 60 caracteres pero 120 bytes
    expect(await readBodyLimited(enTrozos(["ñ".repeat(60)]), 100)).toBeNull();
  });

  test("acepta justo el límite", async () => {
    expect(await readBodyLimited(peticion("a".repeat(100)), 100)).toBe("a".repeat(100));
  });
});
