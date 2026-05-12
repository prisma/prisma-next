/**
 * Regression test.
 *
 * The cipherstash storage codec must NOT advertise the framework's
 * `equality` trait. Re-adding it without re-routing through the
 * cipherstash-namespaced operator surface (`cipherstashEq` /
 * `cipherstashIlike` in `src/execution/operators.ts`) silently re-introduces
 * a wrong-SQL footgun on cipherstash columns:
 *
 *   - `COMPARISON_METHODS_META.eq` (in `packages/3-extensions/sql-orm-client/
 *     src/types.ts`) gates the framework`s built-in `eq` on the column
 *     codec`s `equality` trait. The built-in lowers to standard SQL `=`
 *     via `BinaryExpr eq`.
 *   - EQL ciphertexts contain randomized nonces, so two encrypts of the
 *     same plaintext do not byte-equal under SQL `=`. A built-in
 *     `email.eq('alice@example.com')` on a cipherstash column would
 *     therefore produce `"email" = $1::eql_v2_encrypted` and silently
 *     return zero matches at runtime.
 *   - The supported equality-search call is `email.cipherstashEq(value)`,
 *     which lowers to `eql_v2.eq(...)` (snapshot-pinned in
 *     `operator-lowering.test.ts`).
 *
 * The user-facing `EncryptedString({ equality: true })` flag in PSL/TS
 * authoring is a SEPARATE concept from this codec trait — that flag
 * controls whether the codec lifecycle hook emits an `add_search_config`
 * op for the column`s `unique` index at migration time. The two
 * `equality` concepts share only their name.
 *
 * Recorded here so a future change that flips the trait declaration
 * without re-routing the dispatch trips this test loudly rather than
 * re-opening the footgun.
 */

import { describe, expect, it, vi } from 'vitest';
import { createCipherstashStringCodec } from '../src/execution/codec-runtime';
import { createParameterizedCodecDescriptors } from '../src/execution/parameterized';
import type { CipherstashSdk } from '../src/execution/sdk';
import { cipherstashStringCodecMetadata } from '../src/extension-metadata/codec-metadata';

function emptySdk(): CipherstashSdk {
  return {
    decrypt: vi.fn(),
    bulkEncrypt: vi.fn(),
    bulkDecrypt: vi.fn(),
  };
}

describe('cipherstash codec: no `equality` trait', () => {
  it('runtime codec never advertises the framework `equality` trait', () => {
    const codec = createCipherstashStringCodec(emptySdk());
    const traits: ReadonlyArray<string> = codec.descriptor.traits ?? [];
    expect(traits).not.toContain('equality');
    // Cipherstash-namespaced traits (load-bearing for the multi-codec
    // operator dispatch) ARE expected — they're isolated from
    // framework built-ins by the `cipherstash:` prefix.
    expect(traits.some((t) => t.startsWith('cipherstash:'))).toBe(true);
  });

  it('parameterized codec descriptors (the ones the runtime consumes for dispatch) never advertise `equality`', () => {
    const descriptors = createParameterizedCodecDescriptors(emptySdk());
    expect(descriptors.length).toBeGreaterThan(0);
    for (const descriptor of descriptors) {
      const traits: ReadonlyArray<string> = descriptor.traits ?? [];
      expect(traits).not.toContain('equality');
      expect(traits.some((t) => t.startsWith('cipherstash:'))).toBe(true);
    }
  });

  it('SDK-free pack-meta codec metadata never advertises `equality`', () => {
    const traits: ReadonlyArray<string> = cipherstashStringCodecMetadata.descriptor.traits ?? [];
    expect(traits).not.toContain('equality');
    expect(traits.some((t) => t.startsWith('cipherstash:'))).toBe(true);
  });

  it('the three trait declarations agree (runtime / parameterized / pack-meta) for the string codec', () => {
    // If these three diverge, contract emit (which reads pack-meta) and
    // the runtime (which reads the parameterized descriptor) will
    // disagree about which built-in operations are reachable on
    // cipherstash columns. They must always be identical.
    const runtime = createCipherstashStringCodec(emptySdk()).descriptor.traits ?? [];
    const parameterized =
      createParameterizedCodecDescriptors(emptySdk()).find(
        (d) => d.codecId === 'cipherstash/string@1',
      )?.traits ?? [];
    const packMeta = cipherstashStringCodecMetadata.descriptor.traits ?? [];
    expect([...runtime].sort()).toEqual([...parameterized].sort());
    expect([...runtime].sort()).toEqual([...packMeta].sort());
  });
});

describe('cipherstash columns: framework built-in `eq` is not reachable', () => {
  it('documents the gating contract — built-in `eq` requires `equality` in column traits', () => {
    // This test pins the contract that `cipherstash/string@1` columns
    // intentionally lack the `equality` trait, so the per-column
    // accessor synthesis in `createScalarFieldAccessor` (sql-orm-client)
    // skips `COMPARISON_METHODS_META.eq` (it`s gated on `equality`).
    // The accessor surface for a cipherstash column therefore has no
    // `eq` / `neq` / `in` / `notIn` / `like` / `ilike` keys and only
    // exposes the cipherstash-namespaced operators
    // (`cipherstashEq` / `cipherstashIlike`) plus the always-on null
    // checks (`isNull` / `isNotNull`).
    //
    // The end-to-end behavior — `(model accessor for cipherstash column).eq`
    // is `undefined` — is exercised at the `sql-orm-client` layer
    // (`packages/3-extensions/sql-orm-client/test/model-accessor.test.ts`
    // already pins gating behavior for non-textual codecs via the
    // `does not expose ilike on non-textual fields` test). Cipherstash
    // does not depend on `sql-orm-client`, so this test asserts the
    // *cause* (empty trait list) rather than the *effect* (undefined
    // accessor key); a sibling `does not expose eq on cipherstash
    // columns` test belongs in `sql-orm-client/test/model-accessor.test.ts`
    // when that fixture grows a cipherstash codec entry.
    // Widen via `ReadonlyArray<string>` so `includes('equality')` is
    // well-typed even when TS narrows the codec`s `traits` to
    // `readonly never[]` (which is itself a strong static signal that
    // the trait can`t be present).
    const traits: ReadonlyArray<string> =
      createCipherstashStringCodec(emptySdk()).descriptor.traits ?? [];
    expect(traits.includes('equality')).toBe(false);
  });
});
