import { defineConfig } from "vitest/config";

/**
 * Configuração separada do `vite.config.ts` de propósito: os testes cobrem
 * funções puras (geometria, paradas, ajustes, URLs de tile, roteamento) e não
 * se beneficiam dos plugins do app — nem do `vite-plugin-singlefile`, que
 * reescreve a saída de build.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
