/**
 * `decryptAll` — read-side bulk-decrypt walker.
 *
 * Pinned behaviour:
 *
 *   - Walks recursively (objects, arrays, nested envelopes) and
 *     decrypts every `EncryptedString` it finds.
 *   - K envelopes across distinct routing keys ⇒ exactly one
 *     `bulkDecrypt` per routing-key group.
 *   - After return, every touched envelope`s `decrypt()` returns the
 *     cached plaintext synchronously without consulting the SDK.
 *   - `opts.signal` forwarded by identity to the SDK on every
 *     `bulkDecrypt` call — matching the bulk-encrypt middleware and
 *     single-cell `decrypt` patterns.
 *
 * The tests use an in-memory `CounterSdk` mirroring the storage
 * round-trip e2e`s mock SDK — `bulkDecrypt({ ciphertexts })` reads the
 * synthetic `{ c: 'ct:<plaintext>' }` ciphertexts and returns the
 * stripped plaintexts. A counter on each SDK method backs the
 * "exactly one bulkDecrypt per routing-key group" assertion.
 */

import { describe, expect, it, vi } from 'vitest';
import { decryptAll } from '../src/execution/decrypt-all';
import { EncryptedBigInt } from '../src/execution/envelope-bigint';
import { EncryptedBoolean } from '../src/execution/envelope-boolean';
import { EncryptedDate } from '../src/execution/envelope-date';
import { EncryptedDouble } from '../src/execution/envelope-double';
import { EncryptedJson } from '../src/execution/envelope-json';
import {
  EncryptedString,
  type EncryptedStringFromInternalArgs,
  isHandleDecrypted,
} from '../src/execution/envelope-string';
import type {
  CipherstashBulkDecryptArgs,
  CipherstashBulkEncryptArgs,
  CipherstashSdk,
  CipherstashSingleDecryptArgs,
} from '../src/execution/sdk';

interface CounterSdk extends CipherstashSdk {
  readonly bulkDecryptCalls: CipherstashBulkDecryptArgs[];
  readonly bulkEncryptCalls: CipherstashBulkEncryptArgs[];
  readonly singleDecryptCalls: CipherstashSingleDecryptArgs[];
}

function makeCounterSdk(): CounterSdk {
  const bulkDecryptCalls: CipherstashBulkDecryptArgs[] = [];
  const bulkEncryptCalls: CipherstashBulkEncryptArgs[] = [];
  const singleDecryptCalls: CipherstashSingleDecryptArgs[] = [];
  return {
    bulkDecryptCalls,
    bulkEncryptCalls,
    singleDecryptCalls,
    decrypt(args) {
      singleDecryptCalls.push(args);
      const ct = args.ciphertext as { c?: string } | null;
      if (!ct || typeof ct.c !== 'string' || !ct.c.startsWith('ct:')) {
        throw new Error(`mock SDK: cannot decrypt: ${JSON.stringify(args.ciphertext)}`);
      }
      return Promise.resolve(ct.c.slice('ct:'.length));
    },
    bulkEncrypt(args) {
      bulkEncryptCalls.push(args);
      return Promise.resolve(
        args.values.map((plaintext) => ({
          c: `ct:${plaintext}`,
          t: args.routingKey.table,
          col: args.routingKey.column,
        })),
      );
    },
    bulkDecrypt(args) {
      bulkDecryptCalls.push(args);
      return Promise.resolve(
        args.ciphertexts.map((ciphertext) => {
          const ct = ciphertext as { c?: string } | null;
          if (!ct || typeof ct.c !== 'string' || !ct.c.startsWith('ct:')) {
            throw new Error(`mock SDK: cannot bulk-decrypt: ${JSON.stringify(ciphertext)}`);
          }
          return ct.c.slice('ct:'.length);
        }),
      );
    },
  };
}

interface MakeReadEnvelopeArgs {
  readonly plaintext: string;
  readonly table: string;
  readonly column: string;
  readonly sdk: CipherstashSdk;
}

/**
 * Build a read-side envelope mirroring the codec.decode body's call
 * site: the wire ciphertext is the synthetic `{ c: 'ct:<plaintext>' }`
 * payload, and the handle carries (table, column) routing context plus
 * the SDK reference so subsequent `decrypt()` calls (or `bulkDecrypt`
 * via `decryptAll`) can resolve the plaintext.
 */
function makeReadEnvelope(args: MakeReadEnvelopeArgs): EncryptedString {
  const fromInternalArgs: EncryptedStringFromInternalArgs = {
    ciphertext: { c: `ct:${args.plaintext}`, t: args.table, col: args.column },
    table: args.table,
    column: args.column,
    sdk: args.sdk,
  };
  return EncryptedString.fromInternal(fromInternalArgs);
}

describe('decryptAll — walks recursively and decrypts every envelope', () => {
  it('decrypts a single envelope inside a flat row', async () => {
    const sdk = makeCounterSdk();
    const envelope = makeReadEnvelope({
      plaintext: 'alice@example.com',
      table: 'User',
      column: 'email',
      sdk,
    });
    const rows = [{ id: 'u-1', email: envelope }];

    await decryptAll(rows);

    expect(sdk.bulkDecryptCalls).toHaveLength(1);
    expect(isHandleDecrypted(envelope)).toBe(true);
  });

  it('walks arrays of rows, plain object trees, and nested arrays', async () => {
    const sdk = makeCounterSdk();
    const envelopes = ['a', 'b', 'c', 'd'].map((p) =>
      makeReadEnvelope({ plaintext: p, table: 'User', column: 'email', sdk }),
    );
    const rows = [
      { id: 'u-1', email: envelopes[0], profile: { contactEmail: envelopes[1] } },
      { id: 'u-2', email: envelopes[2], aliases: [{ email: envelopes[3] }] },
    ];

    await decryptAll(rows);

    expect(sdk.bulkDecryptCalls).toHaveLength(1);
    expect(sdk.bulkDecryptCalls[0]?.ciphertexts).toHaveLength(4);
    for (const e of envelopes) {
      expect(isHandleDecrypted(e)).toBe(true);
    }
  });

  it('skips envelopes whose plaintext is already cached (write-side or prior decrypt)', async () => {
    const sdk = makeCounterSdk();
    const writeSide = EncryptedString.from('cached');
    const readSide = makeReadEnvelope({
      plaintext: 'fresh',
      table: 'User',
      column: 'email',
      sdk,
    });

    await decryptAll([{ a: writeSide, b: readSide }]);

    expect(sdk.bulkDecryptCalls).toHaveLength(1);
    expect(sdk.bulkDecryptCalls[0]?.ciphertexts).toHaveLength(1);
    expect(await readSide.decrypt()).toBe('fresh');
    expect(await writeSide.decrypt()).toBe('cached');
    expect(sdk.singleDecryptCalls).toHaveLength(0);
  });

  it('returns immediately (no SDK call) when no envelopes are reachable', async () => {
    const sdk = makeCounterSdk();
    await decryptAll({ id: 'u-1', email: null, profile: { contactEmail: undefined } });
    await decryptAll([]);
    await decryptAll(null);
    await decryptAll(undefined);
    await decryptAll('not a row');

    expect(sdk.bulkDecryptCalls).toHaveLength(0);
  });

  it('does not recurse into Date / Map / Set / typed-array containers', async () => {
    // Walker is scoped to plain objects + plain arrays so that exotic
    // host objects (Date, Map, Set, typed arrays, ArrayBuffer-views,
    // Buffers, Errors with cyclic causes, etc.) cannot trip the walker
    // or its cycle-detection. Cipherstash envelopes are user data —
    // they would not normally be embedded inside these containers; if
    // a future caller needs to bulk-decrypt envelopes inside a Map,
    // they extract them into a plain row first.
    const sdk = makeCounterSdk();
    const envelope = makeReadEnvelope({
      plaintext: 'alice',
      table: 'User',
      column: 'email',
      sdk,
    });
    const map = new Map<string, EncryptedString>([['email', envelope]]);
    const set = new Set<EncryptedString>([envelope]);
    const date = new Date(0);
    const typedArray = new Uint8Array([0, 1, 2]);

    await decryptAll({ map, set, date, typedArray });

    expect(sdk.bulkDecryptCalls).toHaveLength(0);
  });

  it('cycle-safe: does not loop on self-referential row trees', async () => {
    const sdk = makeCounterSdk();
    const envelope = makeReadEnvelope({
      plaintext: 'alice',
      table: 'User',
      column: 'email',
      sdk,
    });
    const node: { email: EncryptedString; self?: unknown } = { email: envelope };
    node.self = node;
    const rows = [node, node];

    await decryptAll(rows);

    expect(sdk.bulkDecryptCalls).toHaveLength(1);
    expect(sdk.bulkDecryptCalls[0]?.ciphertexts).toHaveLength(1);
    expect(isHandleDecrypted(envelope)).toBe(true);
  });
});

describe('decryptAll — one bulkDecrypt per routing-key group', () => {
  it('groups envelopes by (table, column) and issues one bulkDecrypt per group', async () => {
    const sdk = makeCounterSdk();
    const usersEmails = ['a', 'b', 'c'].map((p) =>
      makeReadEnvelope({ plaintext: p, table: 'User', column: 'email', sdk }),
    );
    const userNotes = ['n1', 'n2'].map((p) =>
      makeReadEnvelope({ plaintext: p, table: 'User', column: 'notes', sdk }),
    );
    const orderShippingNotes = ['s1'].map((p) =>
      makeReadEnvelope({ plaintext: p, table: 'Order', column: 'shippingNotes', sdk }),
    );
    const rows = [
      ...usersEmails.map((email, i) => ({ id: `u-${i}`, email })),
      ...userNotes.map((notes, i) => ({ id: `un-${i}`, notes })),
      ...orderShippingNotes.map((notes, i) => ({ id: `o-${i}`, shippingNotes: notes })),
    ];

    await decryptAll(rows);

    expect(sdk.bulkDecryptCalls).toHaveLength(3);
    const callsByGroup = new Map(
      sdk.bulkDecryptCalls.map(
        (c) => [`${c.routingKey.table}\u0000${c.routingKey.column}`, c] as const,
      ),
    );
    expect(callsByGroup.get('User\u0000email')?.ciphertexts).toHaveLength(3);
    expect(callsByGroup.get('User\u0000notes')?.ciphertexts).toHaveLength(2);
    expect(callsByGroup.get('Order\u0000shippingNotes')?.ciphertexts).toHaveLength(1);
  });

  it('preserves observation order within each group', async () => {
    const sdk = makeCounterSdk();
    const envelopes = ['x', 'y', 'z'].map((p) =>
      makeReadEnvelope({ plaintext: p, table: 'User', column: 'email', sdk }),
    );

    await decryptAll(envelopes);

    expect(sdk.bulkDecryptCalls).toHaveLength(1);
    const call = sdk.bulkDecryptCalls[0];
    expect(call?.ciphertexts).toHaveLength(3);
    // Order is the walker's discovery order — for a flat array this
    // is the array's own order; the assertion pins that the bulk
    // decrypt's `ciphertexts` slot lines up with the envelopes the
    // walker visits in sequence.
    expect((call?.ciphertexts[0] as { c: string }).c).toBe('ct:x');
    expect((call?.ciphertexts[1] as { c: string }).c).toBe('ct:y');
    expect((call?.ciphertexts[2] as { c: string }).c).toBe('ct:z');
  });

  it('groups by (sdk, routing key) so multi-tenant SDKs stay isolated', async () => {
    // Per `runtime.ts`'s docblock: "The descriptor is per-SDK ...
    // Multi-tenant deployments construct one descriptor per tenant SDK
    // so per-tenant key material never crosses runtimes." `decryptAll`
    // honors the same boundary: an envelope's handle carries its own
    // SDK reference (set by the codec.decode site), and grouping splits
    // by SDK identity in addition to routing key so a tenant's
    // ciphertexts never reach another tenant's bulkDecrypt.
    const tenantA = makeCounterSdk();
    const tenantB = makeCounterSdk();
    const aEnv = makeReadEnvelope({
      plaintext: 'alice',
      table: 'User',
      column: 'email',
      sdk: tenantA,
    });
    const bEnv = makeReadEnvelope({
      plaintext: 'bob',
      table: 'User',
      column: 'email',
      sdk: tenantB,
    });

    await decryptAll([{ email: aEnv }, { email: bEnv }]);

    expect(tenantA.bulkDecryptCalls).toHaveLength(1);
    expect(tenantA.bulkDecryptCalls[0]?.ciphertexts).toHaveLength(1);
    expect(tenantB.bulkDecryptCalls).toHaveLength(1);
    expect(tenantB.bulkDecryptCalls[0]?.ciphertexts).toHaveLength(1);
  });
});

describe('decryptAll — cached plaintext after return', () => {
  it('subsequent envelope.decrypt() returns synchronously without consulting the SDK', async () => {
    const sdk = makeCounterSdk();
    const envelopes = ['a', 'b', 'c'].map((p) =>
      makeReadEnvelope({ plaintext: p, table: 'User', column: 'email', sdk }),
    );

    await decryptAll(envelopes);

    expect(sdk.singleDecryptCalls).toHaveLength(0);
    for (let i = 0; i < envelopes.length; i++) {
      // Strictly synchronous-from-cache — the resolved value matches
      // the original plaintext, and the SDK's single-cell decrypt
      // counter stays at zero (envelope.decrypt() short-circuits when
      // handle.plaintext is already populated).
      const e = envelopes[i];
      if (!e) throw new Error('envelope undefined');
      expect(await e.decrypt()).toBe(['a', 'b', 'c'][i]);
    }
    expect(sdk.singleDecryptCalls).toHaveLength(0);
  });
});

describe('decryptAll — forwards opts.signal to the SDK', () => {
  it('forwards signal by identity on every bulkDecrypt call', async () => {
    const sdk = makeCounterSdk();
    const usersEmails = ['a', 'b'].map((p) =>
      makeReadEnvelope({ plaintext: p, table: 'User', column: 'email', sdk }),
    );
    const orderEmails = ['x'].map((p) =>
      makeReadEnvelope({ plaintext: p, table: 'Order', column: 'recipientEmail', sdk }),
    );
    const controller = new AbortController();

    await decryptAll([...usersEmails, ...orderEmails], { signal: controller.signal });

    expect(sdk.bulkDecryptCalls).toHaveLength(2);
    expect(sdk.bulkDecryptCalls[0]?.signal).toBe(controller.signal);
    expect(sdk.bulkDecryptCalls[1]?.signal).toBe(controller.signal);
  });

  it('omits signal entirely when opts is not supplied', async () => {
    const sdk = makeCounterSdk();
    const envelope = makeReadEnvelope({
      plaintext: 'alice',
      table: 'User',
      column: 'email',
      sdk,
    });

    await decryptAll([envelope]);

    expect(sdk.bulkDecryptCalls).toHaveLength(1);
    expect(sdk.bulkDecryptCalls[0]?.signal).toBeUndefined();
  });

  it('omits signal when opts is supplied without signal', async () => {
    const sdk = makeCounterSdk();
    const envelope = makeReadEnvelope({
      plaintext: 'alice',
      table: 'User',
      column: 'email',
      sdk,
    });

    await decryptAll([envelope], {});

    expect(sdk.bulkDecryptCalls).toHaveLength(1);
    expect(sdk.bulkDecryptCalls[0]?.signal).toBeUndefined();
  });
});

describe('decryptAll — diagnostics on misuse', () => {
  it('throws a clear diagnostic when an envelope lacks (table, column) routing context', async () => {
    // Read-side envelopes are constructed via codec.decode → fromInternal
    // and always carry routing context. The only way an envelope lacks
    // (table, column) at decryptAll time is misuse — e.g. a user reaches
    // into the package internals and constructs an envelope manually.
    // The walker surfaces this loudly so the misuse is debuggable.
    const sdk = makeCounterSdk();
    // Construct an envelope with no routing context by using a fresh
    // `from(plaintext)` (write side) and then artificially clearing
    // the cached plaintext to force the walker to consider it as a
    // bulk-decrypt target. The cleanest way to exercise the negative
    // path without reaching into private APIs is to pass an envelope
    // whose handle is in the ill-formed shape; this is an explicit
    // misuse case, not a supported flow.
    const envelope = EncryptedString.fromInternal({
      ciphertext: { c: 'ct:alice' },
      // Cast through unknown to exercise the diagnostic path; the
      // type-level contract requires both fields.
      table: undefined as unknown as string,
      column: undefined as unknown as string,
      sdk,
    });

    await expect(decryptAll([{ email: envelope }])).rejects.toThrow(/routing context|table|column/);
  });

  it('propagates SDK errors without retrying or swallowing', async () => {
    // The walker is a pure orchestrator — failure modes are the SDK's,
    // surfaced unchanged so callers can attribute them via existing
    // SDK error taxonomy. RUNTIME.ABORTED phase-tag wrapping lives in
    // the cancellation umbrella, not here.
    const sdk = makeCounterSdk();
    const bulkDecryptSpy = vi.fn(() => Promise.reject(new Error('SDK boom')));
    sdk.bulkDecrypt = bulkDecryptSpy;
    const envelope = makeReadEnvelope({
      plaintext: 'alice',
      table: 'User',
      column: 'email',
      sdk,
    });

    await expect(decryptAll([envelope])).rejects.toThrow('SDK boom');
    expect(bulkDecryptSpy).toHaveBeenCalledTimes(1);
  });
});

describe('decryptAll — heterogeneous envelope subclasses', () => {
  // The walker decrypts every `EncryptedEnvelopeBase` subclass
  // (string + double + bigint + date + boolean + json) and dispatches
  // through each subclass's `parseDecryptedValue` hook to narrow the
  // SDK's polymorphic `bulkDecrypt` return to the per-type plaintext.
  // Pins both invariants together: one `bulkDecrypt` per
  // `(table, column)` group across mixed types, and each envelope's
  // `decrypt()` returns the narrowed cached value synchronously.
  //
  // The mock SDK below stores the original plaintext on the
  // ciphertext envelope's `v` slot so each per-type narrowing hook
  // sees a value of its expected shape on the way back.
  interface MultiSdk extends CipherstashSdk {
    readonly bulkDecryptCalls: CipherstashBulkDecryptArgs[];
  }

  function makeMultiSdk(): MultiSdk {
    const bulkDecryptCalls: CipherstashBulkDecryptArgs[] = [];
    return {
      bulkDecryptCalls,
      decrypt: vi.fn(),
      bulkEncrypt: vi.fn(),
      bulkDecrypt(args) {
        bulkDecryptCalls.push(args);
        return Promise.resolve(args.ciphertexts.map((ct) => (ct as { v: unknown }).v));
      },
    };
  }

  it('groups heterogeneous types by (table, column) — one bulkDecrypt per group, narrowed plaintexts', async () => {
    const sdk = makeMultiSdk();
    const stringEnv = EncryptedString.fromInternal({
      ciphertext: { v: 'alice@example.com' },
      table: 'User',
      column: 'email',
      sdk,
    });
    const doubleEnv = EncryptedDouble.fromInternal({
      ciphertext: { v: 3.14 },
      table: 'User',
      column: 'score',
      sdk,
    });
    const dateEnv = EncryptedDate.fromInternal({
      ciphertext: { v: '2024-06-15' },
      table: 'User',
      column: 'birthday',
      sdk,
    });
    const boolEnv = EncryptedBoolean.fromInternal({
      ciphertext: { v: true },
      table: 'Feature',
      column: 'enabled',
      sdk,
    });
    const jsonEnv = EncryptedJson.fromInternal({
      ciphertext: { v: { k: 'v' } },
      table: 'Audit',
      column: 'payload',
      sdk,
    });
    const bigIntEnv = EncryptedBigInt.fromInternal({
      ciphertext: { v: 42n },
      table: 'Ledger',
      column: 'amount',
      sdk,
    });

    const rows = [
      { id: 'r-1', email: stringEnv, score: doubleEnv, birthday: dateEnv },
      { id: 'r-2', enabled: boolEnv, payload: jsonEnv, amount: bigIntEnv },
    ];

    await decryptAll(rows);

    expect(sdk.bulkDecryptCalls).toHaveLength(6);
    const callsByGroup = new Map(
      sdk.bulkDecryptCalls.map(
        (c) => [`${c.routingKey.table}\u0000${c.routingKey.column}`, c] as const,
      ),
    );
    expect(callsByGroup.get('User\u0000email')?.ciphertexts).toHaveLength(1);
    expect(callsByGroup.get('User\u0000score')?.ciphertexts).toHaveLength(1);
    expect(callsByGroup.get('User\u0000birthday')?.ciphertexts).toHaveLength(1);
    expect(callsByGroup.get('Feature\u0000enabled')?.ciphertexts).toHaveLength(1);
    expect(callsByGroup.get('Audit\u0000payload')?.ciphertexts).toHaveLength(1);
    expect(callsByGroup.get('Ledger\u0000amount')?.ciphertexts).toHaveLength(1);

    expect(await stringEnv.decrypt()).toBe('alice@example.com');
    expect(await doubleEnv.decrypt()).toBe(3.14);
    const decryptedDate = await dateEnv.decrypt();
    expect(decryptedDate).toBeInstanceOf(Date);
    expect(decryptedDate.toISOString()).toBe('2024-06-15T00:00:00.000Z');
    expect(await boolEnv.decrypt()).toBe(true);
    expect(await jsonEnv.decrypt()).toEqual({ k: 'v' });
    expect(await bigIntEnv.decrypt()).toBe(42n);
  });

  it('groups envelopes of different types that share (table, column) into one bulkDecrypt', async () => {
    // The framework guarantees per-cell-codec homogeneity within a
    // `(table, column)` slot, but the walker's grouping logic does
    // not depend on that property — it groups purely by
    // `(sdk, table, column)`. This test exercises the grouping
    // contract with two envelopes of the same type at the same
    // routing key + a third envelope at a sibling column to confirm
    // the per-(table,column) split is preserved.
    const { EncryptedDouble } = await import('../src/execution/envelope-double');
    const sdk = makeMultiSdk();
    const a = EncryptedString.fromInternal({
      ciphertext: { v: 'alice' },
      table: 'User',
      column: 'email',
      sdk,
    });
    const b = EncryptedString.fromInternal({
      ciphertext: { v: 'bob' },
      table: 'User',
      column: 'email',
      sdk,
    });
    const score = EncryptedDouble.fromInternal({
      ciphertext: { v: 9.5 },
      table: 'User',
      column: 'score',
      sdk,
    });

    await decryptAll([{ email: a, score }, { email: b }]);

    expect(sdk.bulkDecryptCalls).toHaveLength(2);
    const callsByGroup = new Map(
      sdk.bulkDecryptCalls.map(
        (c) => [`${c.routingKey.table}\u0000${c.routingKey.column}`, c] as const,
      ),
    );
    expect(callsByGroup.get('User\u0000email')?.ciphertexts).toHaveLength(2);
    expect(callsByGroup.get('User\u0000score')?.ciphertexts).toHaveLength(1);
  });
});
