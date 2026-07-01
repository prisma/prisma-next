/**
 * Structural guards for the enum-typing-via-codec slice (TML-2952).
 *
 * Guard 1 — every emit-path enum/value-set type goes through the codec seam
 *      (`CodecLookup.renderValueTypeFor` / `CodecDescriptor.renderValueType`).
 *      The pre-refactor helpers that rendered stored values straight to TS
 *      literals (`renderValueSetUnionBase`, `renderValueSetLiteral`,
 *      `renderEnumValueUnion`, `renderEnumMemberLiteral`) and the
 *      `DomainEnumLookup` indirection stay deleted, and no emit-path source
 *      reintroduces a direct value-to-literal render.
 *
 * Guard 2 — no SQL or framework-emitter source reads `domain.enum` / `ns.enum`
 *      to PRODUCE A TYPE. The single allowed `ns.enum` read in
 *      `generate-contract-dts.ts` feeds `generateEnumBlockType`, which emits the
 *      runtime `db.enums` dictionary block (not a field/column type). The only
 *      domain-enum *typing* reader repo-wide is the Mongo interim resolver
 *      (`packages/2-mongo-family/3-tooling/emitter/src/index.ts`), removed by
 *      TML-2953.
 *
 * Comments are stripped before scanning so the doc comments naming the deleted
 * helpers (here and in the production sources) do not trip the guard.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'node_modules' || entry.name === 'test') continue;
      files.push(...collectSourceFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

function scan(
  relDir: string,
  patterns: readonly RegExp[],
): Array<{ file: string; line: number; text: string }> {
  const hits: Array<{ file: string; line: number; text: string }> = [];
  for (const file of collectSourceFiles(path.join(repoRoot, relDir))) {
    const lines = stripComments(fs.readFileSync(file, 'utf-8')).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      for (const pattern of patterns) {
        if (pattern.test(line)) {
          hits.push({ file: path.relative(repoRoot, file), line: i + 1, text: line.trim() });
          break;
        }
      }
    }
  }
  return hits;
}

// The deleted direct-render helpers and the retired domain-enum typing indirection.
const DELETED_HELPER_PATTERNS = [
  /\brenderValueSetUnionBase\b/,
  /\brenderValueSetLiteral\b/,
  /\brenderEnumValueUnion\b/,
  /\brenderEnumMemberLiteral\b/,
  /\bDomainEnumLookup\b/,
  /\bdomainEnumLookup\b/,
];

// An actual read of the domain enum entity: `.enum` immediately followed by an
// index/optional-index/close-paren (`(ns.enum)`, `.enum[…]`, `.enum?.[…]`).
// This deliberately ignores `.enum` appearing inside a string literal (e.g. a
// `blindCast` reason describing the cast) — only access syntax counts.
const DOMAIN_ENUM_READ = /\.enum\s*(\?\.\[|\[|\))/;

describe('enum/value-set emit typing goes through the codec seam', () => {
  it('the deleted direct-render helpers do not reappear in the framework emitter source', () => {
    const hits = scan('packages/1-framework/3-tooling/emitter', DELETED_HELPER_PATTERNS);
    expect(hits).toEqual([]);
  });

  it('the deleted direct-render helpers do not reappear in the SQL emit-path source', () => {
    const hits = scan('packages/2-sql', DELETED_HELPER_PATTERNS);
    expect(hits).toEqual([]);
  });

  it('the deleted direct-render helpers do not reappear in the Mongo emitter source', () => {
    const hits = scan('packages/2-mongo-family/3-tooling/emitter', DELETED_HELPER_PATTERNS);
    expect(hits).toEqual([]);
  });
});

describe('no SQL/framework-emitter source reads domain.enum to produce a type', () => {
  it('the SQL emitter sources enum field/column types from storage, not domain.enum', () => {
    // The SQL emitter (3-tooling) is the emit-path typing reader; it must source
    // from the storage value set. Authoring layers legitimately build domain.enum,
    // so the guard is scoped to the emitter package.
    const hits = scan('packages/2-sql/3-tooling/emitter', [DOMAIN_ENUM_READ]);
    expect(hits).toEqual([]);
  });

  it('the only ns.enum read in the framework emitter feeds the db.enums dictionary block', () => {
    const hits = scan('packages/1-framework/3-tooling/emitter', [DOMAIN_ENUM_READ]);
    // Exactly one allowed read: generate-contract-dts.ts → generateEnumBlockType.
    expect(hits).toHaveLength(1);
    expect(hits[0]?.file).toBe(
      'packages/1-framework/3-tooling/emitter/src/generate-contract-dts.ts',
    );
  });

  it('the only repo-wide domain-enum typing reader is the Mongo interim resolver', () => {
    // Mongo has no storage value set yet (TML-2953), so its emitter reads
    // domain.enum on an interim basis. This read is expected; the test pins that
    // it is the single Mongo-emitter domain-enum read so its removal is noticed.
    const hits = scan('packages/2-mongo-family/3-tooling/emitter', [DOMAIN_ENUM_READ]);
    expect(hits.map((h) => h.file)).toEqual([
      'packages/2-mongo-family/3-tooling/emitter/src/index.ts',
    ]);
  });
});
