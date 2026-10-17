// Сборка сервера в один ESM-файл (зависимости из node_modules остаются внешними,
// а workspace-пакет @omni/shared встраивается — он поставляется исходниками TS).
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => d !== '@omni/shared');

await build({
  entryPoints: ['src/index.ts', 'src/db/seed.ts', 'src/db/migrate-cli.ts'],
  outdir: 'dist',
  outbase: 'src',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: [...external, 'node:*'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
