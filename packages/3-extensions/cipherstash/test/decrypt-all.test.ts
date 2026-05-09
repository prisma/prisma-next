/**
 * `decryptAll` — read-side bulk-decrypt walker.
 *
 * Pins AC-DEC1..4 (canonical AC list lives in the package`s
 * `DEVELOPING.md § Acceptance criteria → decryptAll walker`):
 *
 *   - **AC-DEC1**: walks recursively (objects, arrays, nested envelopes)
 *     and decrypts every `EncryptedString` it finds.
 *   - **AC-DEC2**: K envelopes across distinct routing keys ⇒ exactly
 *     one `bulkDecrypt` per routing-key group.
 *   - **AC-DEC3**: after return, every touched envelope`s `decrypt()`
 *     returns the cached plaintext synchronously without consulting
 *     the SDK.
 *   - **AC-DEC4**: `opts.signal` forwarded by identity to the SDK on
 *     every `bulkDecrypt` call. (RUNTIME.ABORTED phase-tag wrapping —
 *     the umbrella-level half of AC-DEC4 — is M3 R3 cancellation
 *     scope per the orchestrator`s round prompt; this round only
 *     pins the signal-forwarding contract that matches the existing
 *     bulk-encrypt middleware AC-MW4 + single-cell `decrypt` patterns.)
 *
 * The tests use an in-memory `CounterSdk` mirroring the storage
 * round-trip e2e`s mock SDK — `bulkDecrypt({ ciphertexts })` reads the
 * synthetic `{ c: 'ct:<plaintext>' }` ciphertexts and returns the
 * stripped plaintexts. A counter on each SDK method backs the
 * "exactly one bulkDecrypt per routing-key group" assertion.
 */

import { describe, expect, it, vi } from 'vitest';
import { decryptAll } from '../src/execution/decrypt-all';
import {
  EncryptedString,
  type EncryptedStringFromInternalArgs,
  isHandleDecrypted,
} from '../src/execution/envelope';
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

describe('decryptAll — AC-DEC1 walks recursively and decrypts every envelope', () => {
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

describe('decryptAll — AC-DEC2 one bulkDecrypt per routing-key group', () => {
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

describe('decryptAll — AC-DEC3 cached plaintext after return', () => {
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

describe('decryptAll — AC-DEC4 forwards opts.signal to the SDK', () => {
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
    // whose handle is in the ill-formed shape; the spec's open-question
    // 5 (resolved) confirms this is a misuse case, not a supported flow.
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
    // SDK error taxonomy. AC-MW-style error envelopes (RUNTIME.ABORTED
    // phase tags) are M3 R3 cancellation umbrella scope.
    const sdk = makeCounterSdk();
    sdk.bulkDecrypt = vi.fn(() => Promise.reject(new Error('SDK boom')));
    const envelope = makeReadEnvelope({
      plaintext: 'alice',
      table: 'User',
      column: 'email',
      sdk,
    });

    await expect(decryptAll([envelope])).rejects.toThrow('SDK boom');
  });
});
