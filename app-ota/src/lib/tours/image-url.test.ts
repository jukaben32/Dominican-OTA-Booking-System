import { afterEach, describe, expect, test, vi } from "vitest";
import { tourImageUrl } from "./image-url";

afterEach(() => vi.unstubAllEnvs());

describe("tourImageUrl", () => {
  test("arma la dirección pública de la foto", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proyecto.supabase.co/");
    expect(tourImageUrl("tours/abc/foto.jpg")).toBe("https://proyecto.supabase.co/storage/v1/object/public/tour-images/tours/abc/foto.jpg");
  });

  test("sin ruta o sin configuración devuelve null", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proyecto.supabase.co");
    expect(tourImageUrl(null)).toBeNull();
    expect(tourImageUrl("")).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(tourImageUrl("x.jpg")).toBeNull();
  });
});
