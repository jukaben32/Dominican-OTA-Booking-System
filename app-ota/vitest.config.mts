import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Configuración de las pruebas automáticas (Vitest)
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // Solo medimos la lógica de negocio en src/lib (lo delicado: dinero y fechas)
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/**/*.test.ts", "src/lib/supabase/**", "src/lib/auth.ts", "src/lib/logger.ts", "src/lib/**/fake-*.ts"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
  resolve: {
    // Permite escribir "@/lib/..." igual que en el resto del proyecto
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
});
