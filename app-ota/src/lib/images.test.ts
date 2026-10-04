import { describe, expect, test } from "vitest";
import { MAX_IMAGE_BYTES, validateImageUpload } from "./images";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
// "RIFF" + tamaño + "WEBP"
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);

describe("validateImageUpload", () => {
  test("acepta JPEG, PNG y WebP reales y devuelve extensión y tipo", () => {
    expect(validateImageUpload(jpeg)).toEqual({ ok: true, ext: "jpg", mime: "image/jpeg" });
    expect(validateImageUpload(png)).toEqual({ ok: true, ext: "png", mime: "image/png" });
    expect(validateImageUpload(webp)).toEqual({ ok: true, ext: "webp", mime: "image/webp" });
  });

  test("decide por el CONTENIDO del archivo, no por el nombre ni el tipo que declara el navegador", () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    const r = validateImageUpload(html);
    expect(r.ok).toBe(false);
  });

  test("rechaza un SVG (puede traer scripts), un PDF y archivos vacíos", () => {
    expect(validateImageUpload(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).ok).toBe(false);
    expect(validateImageUpload(new TextEncoder().encode("%PDF-1.7")).ok).toBe(false);
    expect(validateImageUpload(new Uint8Array(0)).ok).toBe(false);
  });

  test("rechaza imágenes más grandes que el límite", () => {
    const grande = new Uint8Array(MAX_IMAGE_BYTES + 1);
    grande.set(jpeg);
    const r = validateImageUpload(grande);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/MB/);
  });

  test("acepta una imagen justo en el límite", () => {
    const limite = new Uint8Array(MAX_IMAGE_BYTES);
    limite.set(jpeg);
    expect(validateImageUpload(limite).ok).toBe(true);
  });

  test("un RIFF que no es WebP (por ejemplo un WAV) se rechaza", () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]);
    expect(validateImageUpload(wav).ok).toBe(false);
  });
});
