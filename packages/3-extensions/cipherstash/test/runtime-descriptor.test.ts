/**
 * `createCipherstashRuntimeDescriptor({ sdk })` — the consumer-facing
 * wrapper that composes the SDK-bound parameterized codec descriptor
 * into a single `SqlRuntimeExtensionDescriptor<'postgres'>`.
 *
 * The wrapper exposes the parameterized descriptor on
 * `types.codecTypes.codecDescriptors` and through `codecs()`. The
 * runtime extracts the descriptor at dispatch time and resolves a
 * per-instance codec via `descriptor.factory(params)(ctx)`. The
 * bulk-encrypt middleware ships separately under `./middleware`.
 *
 * Mirrors the pgvector wrapper at
 * `packages/3-extensions/pgvector/src/exports/runtime.ts:62-88`.
 */

import { describe, expect, it, vi } from 'vitest';
import type { CipherstashSdk } from '../src/execution/sdk';
import {
  CIPHERSTASH_EXTENSION_VERSION,
  createCipherstashRuntimeDescriptor,
} from '../src/exports/runtime';
import {
  CIPHERSTASH_SPACE_ID,
  CIPHERSTASH_STRING_CODEC_ID,
} from '../src/extension-metadata/constants';

function emptySdk(): CipherstashSdk {
  return {
    decrypt: vi.fn(),
    bulkEncrypt: vi.fn(),
    bulkDecrypt: vi.fn(),
  };
}

describe('createCipherstashRuntimeDescriptor — descriptor shape', () => {
  it('declares kind=extension with the cipherstash id, version, family, target', () => {
    const descriptor = createCipherstashRuntimeDescriptor({ sdk: emptySdk() });
    expect(descriptor.kind).toBe('extension');
    expect(descriptor.id).toBe(CIPHERSTASH_SPACE_ID);
    expect(descriptor.version).toBe(CIPHERSTASH_EXTENSION_VERSION);
    expect(descriptor.familyId).toBe('sql');
    expect(descriptor.targetId).toBe('postgres');
  });

  it('exposes the cipherstash codec descriptors under types.codecTypes.codecDescriptors', () => {
    // R4 wires the full six-codec surface (string + double + bigint +
    // date + boolean + json). The current-state count + ordering is
    // pinned here so a missed wiring surfaces in unit tests instead
    // of leaking through e2e.
    const descriptor = createCipherstashRuntimeDescriptor({ sdk: emptySdk() });
    const codecDescriptors = descriptor.types?.codecTypes?.codecDescriptors ?? [];
    expect(codecDescriptors).toHaveLength(6);
    expect(codecDescriptors[0]?.codecId).toBe(CIPHERSTASH_STRING_CODEC_ID);
    expect(codecDescriptors[1]?.codecId).toBe('cipherstash/double@1');
    expect(codecDescriptors[2]?.codecId).toBe('cipherstash/bigint@1');
    expect(codecDescriptors[3]?.codecId).toBe('cipherstash/date@1');
    expect(codecDescriptors[4]?.codecId).toBe('cipherstash/boolean@1');
    expect(codecDescriptors[5]?.codecId).toBe('cipherstash/json@1');
  });
});

describe('createCipherstashRuntimeDescriptor — codecs()', () => {
  it('returns the parameterized codec descriptors in stable order', () => {
    const descriptor = createCipherstashRuntimeDescriptor({ sdk: emptySdk() });
    const codecs = descriptor.codecs?.() ?? [];
    expect(codecs).toHaveLength(6);
    expect(codecs.map((c) => c.codecId)).toEqual([
      CIPHERSTASH_STRING_CODEC_ID,
      'cipherstash/double@1',
      'cipherstash/bigint@1',
      'cipherstash/date@1',
      'cipherstash/boolean@1',
      'cipherstash/json@1',
    ]);
    for (const c of codecs) {
      expect(c.targetTypes).toEqual(['eql_v2_encrypted']);
      // Per-codec `cipherstash:*` namespaced traits drive the
      // multi-codec operator dispatch (see
      // `extension-metadata/constants.ts` →
      // `CIPHERSTASH_CODEC_TRAITS`); the framework `'equality'` trait
      // is intentionally absent across every cipherstash codec so the
      // built-in `eq` does not silently re-attach (see
      // `equality-trait-removal.test.ts`).
      const traits: ReadonlyArray<string> = c.traits ?? [];
      expect(traits.includes('equality')).toBe(false);
      expect(traits.length).toBeGreaterThan(0);
      for (const trait of traits) {
        expect(trait.startsWith('cipherstash:')).toBe(true);
      }
    }
  });
});

describe('createCipherstashRuntimeDescriptor — create() returns a target-bound instance', () => {
  it('returns a SqlRuntimeExtensionInstance carrying the SQL family and Postgres target', () => {
    const descriptor = createCipherstashRuntimeDescriptor({ sdk: emptySdk() });
    const instance = descriptor.create();
    expect(instance.familyId).toBe('sql');
    expect(instance.targetId).toBe('postgres');
  });
});

describe('createCipherstashRuntimeDescriptor — SDK isolation per descriptor', () => {
  it('produces a different codec instance per invocation so per-tenant SDKs do not cross-talk', () => {
    const a = createCipherstashRuntimeDescriptor({ sdk: emptySdk() });
    const b = createCipherstashRuntimeDescriptor({ sdk: emptySdk() });
    const codecA = a.codecs?.()[0]?.factory({
      equality: false,
      freeTextSearch: false,
      orderAndRange: false,
    })({
      name: 'x.y',
    });
    const codecB = b.codecs?.()[0]?.factory({
      equality: false,
      freeTextSearch: false,
      orderAndRange: false,
    })({
      name: 'x.y',
    });
    expect(codecA).not.toBe(codecB);
  });
});
