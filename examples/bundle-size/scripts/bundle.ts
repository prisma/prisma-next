import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const require_ = createRequire(import.meta.url);
const pkg: { dependencies?: Record<string, string> } = require_(resolve(root, 'package.json'));

// Only mark the Node-runtime drivers (`pg`, `mongodb`) external. Everything
// Prisma Next owns is inlined into the bundle — that's the realistic shape of
// a serverless / single-binary deployment.
const external = ['pg', 'pg-native', 'mongodb'];

await mkdir(resolve(root, 'dist'), { recursive: true });

interface BundleSpec {
  readonly label: string;
  readonly entry: string;
  readonly outBase: string;
}

const bundles: readonly BundleSpec[] = [
  {
    label: 'postgres / no-emit (TS contract)',
    entry: 'src/postgres/main.ts',
    outBase: 'dist/postgres-no-emit',
  },
  {
    label: 'postgres / emit (contract.json)',
    entry: 'src/postgres/main-emit.ts',
    outBase: 'dist/postgres-emit',
  },
  {
    label: 'mongo    / no-emit (TS contract)',
    entry: 'src/mongo/main.ts',
    outBase: 'dist/mongo-no-emit',
  },
  {
    label: 'mongo    / emit (contract.json)',
    entry: 'src/mongo/main-emit.ts',
    outBase: 'dist/mongo-emit',
  },
];

interface Variant {
  readonly label: 'minified' | 'unminified';
  readonly minify: boolean;
  readonly suffix: string;
}

const variants: readonly Variant[] = [
  { label: 'unminified', minify: false, suffix: '.bundle.mjs' },
  { label: 'minified', minify: true, suffix: '.bundle.min.mjs' },
];

interface BuildOutput {
  readonly spec: BundleSpec;
  readonly variant: Variant;
  readonly outfile: string;
  readonly bytes: number;
  readonly gzipBytes: number;
  readonly metafile: esbuild.Metafile;
}

const outputs: BuildOutput[] = [];

for (const spec of bundles) {
  for (const variant of variants) {
    const outfile = resolve(root, `${spec.outBase}${variant.suffix}`);
    const built = await esbuild.build({
      entryPoints: [resolve(root, spec.entry)],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node24',
      minify: variant.minify,
      treeShaking: true,
      external,
      legalComments: 'none',
      metafile: true,
      logLevel: 'warning',
    });
    const { size } = await stat(outfile);
    const contents = await readFile(outfile);
    const gzipped = gzipSync(contents, { level: 9 });
    // Persist the .gz alongside so consumers can inspect it.
    await writeFile(`${outfile}.gz`, gzipped);
    outputs.push({
      spec,
      variant,
      outfile,
      bytes: size,
      gzipBytes: gzipped.byteLength,
      metafile: built.metafile,
    });
  }
}

const fmtBytes = (n: number) => `${n.toLocaleString().padStart(9)} bytes`;
const fmtKiB = (n: number) => `${(n / 1024).toFixed(1).padStart(6)} KiB`;

console.log('');
console.log(`deps:     ${Object.keys(pkg.dependencies ?? {}).join(', ')}`);
console.log(`external: ${external.join(', ')}`);
console.log('');

console.log('bundles:');
console.log(
  `  ${'entry'.padEnd(40)}  ${'variant'.padEnd(10)}  ${'raw'.padStart(22)}  ${'gzip (level 9)'.padStart(22)}`,
);
for (const { spec, variant, bytes, gzipBytes } of outputs) {
  console.log(
    `  ${spec.label.padEnd(40)}  ${variant.label.padEnd(10)}  ${fmtBytes(bytes)} (${fmtKiB(bytes)})  ${fmtBytes(gzipBytes)} (${fmtKiB(gzipBytes)})`,
  );
}

console.log('');
for (const { spec, variant, metafile } of outputs) {
  if (variant.label !== 'minified') continue; // top inputs are identical across variants
  console.log(`top 10 inputs — ${spec.label}:`);
  const top = Object.entries(metafile.inputs)
    .map(([path, info]) => ({ path, bytes: info.bytes }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10);
  for (const { path, bytes } of top) {
    const display = relative(resolve(root, '..', '..'), resolve(root, path));
    console.log(`  ${(bytes / 1024).toFixed(1).padStart(7)} KiB  ${display}`);
  }
  console.log('');
}
