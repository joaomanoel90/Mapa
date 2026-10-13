import { defineConfig } from "vitest/config";

/**
 * Configuração separada do `vite.config.ts` de propósito: os testes cobrem
 * funções puras (geometria, paradas, ajustes, URLs de tile, roteamento) e não
 * se beneficiam dos plugins do app — nem do `vite-plugin-singlefile`, que
 * reescreve a saída de build.
 *
 * O `*.test.tsx` entrou junto com o primeiro teste de componente: o bug do
 * campo que perdia o foco ao digitar não aparecia em teste de função pura —
 * ele só existe no comportamento do React entre um render e o seguinte.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
