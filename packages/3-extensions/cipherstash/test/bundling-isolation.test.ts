/**
 * AC-UMB9 — control vs runtime/middleware byte-level subpath isolation.
 *
 * The cipherstash extension publishes three runtime-relevant subpath
 * entries: `./control` (contract-space authoring + the codec lifecycle
 * hook), `./runtime` (envelope + SDK + codec runtime), and
 * `./middleware` (bulk-encrypt middleware). Each entry must compose
 * tree-shakably so a consumer pulling `./runtime` does not drag in the
 * EQL bundle SQL, the cipherstash baseline migration, or the codec
 * lifecycle hook (any of which would defeat the runtime-bundle size
 * budget and leak control-plane behaviour into runtime call paths) and
 * a consumer pulling `./control` does not drag in `EncryptedString`,
 * the SDK interface, the codec runtime, or the bulk-encrypt middleware.
 *
 * This test is the canonical AC-UMB9 guard. It asserts:
 *
 *   1. **Entry-body forbidden-substring check** (per entry): the
 *      entry `.mjs` body — both the inline source and its `import` /
 *      `export` statements — does not contain forbidden symbol names.
 *      Mirrors the predecessor `wip/verify-cipherstash-isolation.mjs`
 *      shallow check, which catches both inlined runtime behavior in
 *      a control entry and cross-chunk leaks via named-import lines
 *      (`import { ForbiddenName } from "./<chunk>.mjs"`). Forbidden
 *      identifiers occurring inside a chunk's JSDoc or as a PSL type
 *      identifier string literal are out of scope — they ship no
 *      executable behavior — and are caught structurally by the
 *      disjointness check below if the chunk crosses planes.
 *   2. **Chunk-graph disjointness**: control's transitively reachable
 *      chunk-file set and runtime's (resp. middleware's) chunk-file
 *      set are disjoint, modulo the shared `constants-*.mjs` chunk
 *      (pure literal constants — no SDK / codec / migration code).
 *
 * The dist outputs are produced by `tsdown` from `src/exports/*.ts`.
 * `@prisma-next/extension-cipherstash#test` is wired in the root
 * `turbo.json` to depend on its own `build`, so the assertions below
 * always read fresh dist output for the current source.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(PACKAGE_ROOT, 'dist');

const ENTRY_FILES = ['control.mjs', 'runtime.mjs', 'middleware.mjs'] as const;

/**
 * Forbidden in `control.mjs` and its transitive chunk graph.
 * These are runtime-plane symbols (envelope / SDK interface / codec
 * runtime / middleware factory) that must never reach a control-plane
 * consumer.
 */
const CONTROL_FORBIDDEN = [
  'EncryptedString',
  'setHandleCiphertext',
  'CipherstashSdk',
  'bulkEncryptMiddleware',
  'createCipherstashStringCodec',
  'createCipherstashRuntimeDescriptor',
] as const;

/**
 * Forbidden in `runtime.mjs` / `middleware.mjs` and their transitive
 * chunk graph. These are contract-space artefacts (EQL bundle SQL,
 * cipherstash contract IR, baseline migration, head-ref, the
 * codec-control lifecycle hook, EQL bundle migration-op terms) that
 * must never reach a runtime consumer.
 */
const RUNTIME_FORBIDDEN = [
  'EQL_BUNDLE_SQL',
  'cipherstashContract',
  'cipherstashBaselineMigration',
  'cipherstashHeadRef',
  'cipherstashStringCodecHooks',
  'add_search_config',
  'remove_search_config',
] as const;

/**
 * Chunks whose name matches this pattern are allowed to appear in
 * both the control graph and the runtime graph. `constants-*.mjs`
 * carries pure literal constants (codec id, native types, invariant
 * ids) — sharing them across planes is safe and desirable.
 */
const SHARED_CHUNK_PATTERN = /^constants-[A-Za-z0-9_-]+\.mjs$/;

interface ChunkFile {
  readonly file: string;
  readonly body: string;
  readonly size: number;
}

function readChunk(file: string): ChunkFile {
  const path = join(DIST, file);
  const body = readFileSync(path, 'utf8');
  return { file, body, size: Buffer.byteLength(body, 'utf8') };
}

const RELATIVE_IMPORT_RE = /from\s+["'](\.\/[^"']+\.mjs)["']/g;

function collectGraph(entry: string): Map<string, ChunkFile> {
  const graph = new Map<string, ChunkFile>();
  const queue: string[] = [entry];
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined || graph.has(next)) {
      continue;
    }
    const chunk = readChunk(next);
    graph.set(next, chunk);
    for (const match of chunk.body.matchAll(RELATIVE_IMPORT_RE)) {
      const importPath = match[1];
      if (importPath === undefined) {
        continue;
      }
      const importFile = importPath.replace(/^\.\//, '');
      if (!graph.has(importFile)) {
        queue.push(importFile);
      }
    }
  }
  return graph;
}

function findLeaksInEntry(entry: ChunkFile, forbidden: readonly string[]): string[] {
  return forbidden.filter((needle) => entry.body.includes(needle));
}

describe('bundling isolation (AC-UMB9)', () => {
  it('dist entry files exist (run `pnpm --filter @prisma-next/extension-cipherstash build` first)', () => {
    for (const entry of ENTRY_FILES) {
      expect(existsSync(join(DIST, entry)), `dist/${entry} is missing`).toBe(true);
    }
  });

  it('control.mjs does not pull runtime-plane symbols', () => {
    const entry = readChunk('control.mjs');
    const leaks = findLeaksInEntry(entry, CONTROL_FORBIDDEN);
    expect(leaks, `control entry leaks: ${leaks.join(', ')}`).toEqual([]);
  });

  it('runtime.mjs does not pull contract-space artefacts', () => {
    const entry = readChunk('runtime.mjs');
    const leaks = findLeaksInEntry(entry, RUNTIME_FORBIDDEN);
    expect(leaks, `runtime entry leaks: ${leaks.join(', ')}`).toEqual([]);
  });

  it('middleware.mjs does not pull contract-space artefacts', () => {
    const entry = readChunk('middleware.mjs');
    const leaks = findLeaksInEntry(entry, RUNTIME_FORBIDDEN);
    expect(leaks, `middleware entry leaks: ${leaks.join(', ')}`).toEqual([]);
  });

  it('control vs runtime chunk graphs are disjoint (modulo shared constants chunk)', () => {
    const controlChunks = new Set(collectGraph('control.mjs').keys());
    const runtimeChunks = new Set(collectGraph('runtime.mjs').keys());
    controlChunks.delete('control.mjs');
    runtimeChunks.delete('runtime.mjs');
    const intersection = [...controlChunks].filter((f) => runtimeChunks.has(f));
    const unexpectedShared = intersection.filter((f) => !SHARED_CHUNK_PATTERN.test(f));
    expect(
      unexpectedShared,
      `control & runtime share unexpected chunks: ${unexpectedShared.join(', ')}`,
    ).toEqual([]);
  });

  it('control vs middleware chunk graphs are disjoint (modulo shared constants chunk)', () => {
    const controlChunks = new Set(collectGraph('control.mjs').keys());
    const middlewareChunks = new Set(collectGraph('middleware.mjs').keys());
    controlChunks.delete('control.mjs');
    middlewareChunks.delete('middleware.mjs');
    const intersection = [...controlChunks].filter((f) => middlewareChunks.has(f));
    const unexpectedShared = intersection.filter((f) => !SHARED_CHUNK_PATTERN.test(f));
    expect(
      unexpectedShared,
      `control & middleware share unexpected chunks: ${unexpectedShared.join(', ')}`,
    ).toEqual([]);
  });
});
