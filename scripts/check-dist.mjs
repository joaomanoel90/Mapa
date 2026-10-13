#!/usr/bin/env node
/**
 * Verificação de fumaça do build.
 *
 * O app precisa sair do Vite como UM arquivo só, com JavaScript e CSS
 * embutidos, e sem nenhum caminho absoluto para `/src/`.
 *
 * O motivo de existir: o GitHub Pages já publicou a raiz do repositório por
 * engano, servindo `index.html` apontando para `/src/main.tsx`. O navegador não
 * executa `.tsx`, o caminho ainda apontava para fora da subpasta `/Mapa/`, e o
 * site abria em branco. Esta checagem transforma aquele incidente silencioso
 * numa falha de CI.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";

const DIST = "dist";
const INDEX = `${DIST}/index.html`;
const problemas = [];

if (!existsSync(INDEX)) {
  problemas.push(`não existe ${INDEX} — rode "npm run build" antes`);
} else {
  const html = readFileSync(INDEX, "utf8");

  if (/src=["']\/src\//.test(html)) {
    problemas.push(
      "o HTML aponta para /src/ — o build não foi aplicado e o site serviria código-fonte",
    );
  }
  if (!html.includes('id="root"')) {
    problemas.push('o HTML não tem <div id="root"> — o React não teria onde montar');
  }
  if (!/<script[^>]*>[\s\S]*<\/script>/.test(html)) {
    problemas.push("o HTML não tem JavaScript embutido");
  }
  if (/<script[^>]+src=["']https?:/.test(html)) {
    problemas.push("o HTML carrega script de fora — o build deveria ser autocontido");
  }
}

if (existsSync(DIST)) {
  const arquivos = readdirSync(DIST, { recursive: true }).map(String);
  const soltos = arquivos.filter((f) => /\.(tsx|ts|jsx)$/.test(f));
  if (soltos.length > 0) {
    problemas.push(`o build incluiu código-fonte solto: ${soltos.join(", ")}`);
  }
}

if (problemas.length > 0) {
  console.error("✗ Verificação do build falhou:");
  for (const p of problemas) console.error(`  - ${p}`);
  process.exit(1);
}

console.log("✓ Build autocontido, sem referências a /src/ — seguro para subpasta");
