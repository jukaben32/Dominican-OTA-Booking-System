import type { NextConfig } from "next";

// Cabeceras de seguridad para todas las rutas.
// ⚠️ Pendiente (endurecimiento antes de producción): una política CSP con "nonce" para los scripts.
const cabecerasSeguridad = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

// Las fotos de los tours se sirven desde el almacenamiento público de Supabase
const supabaseHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  // Los comprobantes de pago pueden pesar hasta 5 MB (+ el formulario que los acompaña)
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  images: {
    remotePatterns: supabaseHost
      ? [{ protocol: "https", hostname: supabaseHost, pathname: "/storage/v1/object/public/tour-images/**" }]
      : [],
  },
  async headers() {
    return [{ source: "/:path*", headers: cabecerasSeguridad }];
  },
};

export default nextConfig;
