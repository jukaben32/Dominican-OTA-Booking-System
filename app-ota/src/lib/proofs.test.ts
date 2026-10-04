import { describe, expect, test } from "vitest";
import { MAX_PROOF_BYTES, readProofFromForm, validateProofUpload } from "./proofs";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const pdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj");

describe("validateProofUpload", () => {
  test("acepta foto JPG, PNG, WebP y PDF", () => {
    expect(validateProofUpload(jpeg)).toEqual({ ok: true, ext: "jpg", mime: "image/jpeg" });
    expect(validateProofUpload(png)).toEqual({ ok: true, ext: "png", mime: "image/png" });
    expect(validateProofUpload(webp)).toEqual({ ok: true, ext: "webp", mime: "image/webp" });
    expect(validateProofUpload(pdf)).toEqual({ ok: true, ext: "pdf", mime: "application/pdf" });
  });

  test("rechaza HTML, SVG, ejecutables y texto aunque se llamen .jpg", () => {
    for (const malo of ["<html><script>alert(1)</script></html>", '<svg xmlns="http://www.w3.org/2000/svg"/>', "MZ\u0090\u0000", "texto cualquiera"]) {
      expect(validateProofUpload(new TextEncoder().encode(malo)).ok).toBe(false);
    }
  });

  test("rechaza archivos vacíos y más grandes que el límite, y acepta justo el límite", () => {
    expect(validateProofUpload(new Uint8Array(0)).ok).toBe(false);
    const grande = new Uint8Array(MAX_PROOF_BYTES + 1);
    grande.set(pdf);
    const r = validateProofUpload(grande);
    expect(r.ok === false && r.error).toMatch(/5 MB/);
    const limite = new Uint8Array(MAX_PROOF_BYTES);
    limite.set(pdf);
    expect(validateProofUpload(limite).ok).toBe(true);
  });

  test("un PDF a medias (solo '%PDF' sin guion) no pasa", () => {
    expect(validateProofUpload(new TextEncoder().encode("%PDF")).ok).toBe(false);
  });
});

describe("readProofFromForm", () => {
  const archivo = (contenido: Uint8Array, nombre = "c.jpg") => new File([contenido as BlobPart], nombre);

  test("sin archivo elegido no es un error: el comprobante es opcional", async () => {
    expect(await readProofFromForm(null)).toEqual({ ok: true, proof: null });
    expect(await readProofFromForm("texto suelto")).toEqual({ ok: true, proof: null });
    expect(await readProofFromForm(new File([], ""))).toEqual({ ok: true, proof: null });
  });

  test("devuelve el archivo con su tipo REAL, no el que dice el nombre", async () => {
    const r = await readProofFromForm(archivo(pdf, "foto.jpg"));
    expect(r.ok && r.proof?.ext).toBe("pdf");
    expect(r.ok && r.proof?.mime).toBe("application/pdf");
  });

  test("rechaza un archivo que no es foto ni PDF", async () => {
    const r = await readProofFromForm(archivo(new TextEncoder().encode("<html></html>"), "c.jpg"));
    expect(r.ok).toBe(false);
  });

  test("rechaza por tamaño sin leer el contenido", async () => {
    const r = await readProofFromForm(archivo(new Uint8Array(MAX_PROOF_BYTES + 1)));
    expect(r.ok === false && r.error).toMatch(/5 MB/);
  });
});
