/**
 * `decryptAll` — read-side bulk-decrypt walker.
 *
 * Public utility users invoke after `findMany` (or any other read
 * surface) to materialize the plaintext for every cipherstash envelope
 * (any `EncryptedEnvelopeBase` subclass — string / double / bigint /
 * date / boolean / json) reachable from the result set in a fixed
 * number of bulk SDK round-trips:
 *
 *     const rows = await db.select(...).from(User).execute();
 *     await decryptAll(rows);
 *     // every envelope's `decrypt()` now returns plaintext synchronously.
 *
 * Why a separate utility (rather than middleware that auto-decrypts on
 * every read): the framework`s streaming-read path cannot bulk-amortize
 * decryption across rows it`s yielding incrementally — by the time row
 * N is yielded, rows 1..N-1 have already been delivered to the caller.
 * The `decryptAll` shape lets the caller buffer the result set
 * explicitly (with `await stream.toArray()`) and then opt into bulk
 * decryption in one round-trip per `(table, column)` group. The runtime
 * descriptor wrapper deliberately does NOT register an implicit-decrypt
 * middleware for this reason.
 *
 * **Walker shape**.
 *
 * - Recursive on plain objects + plain arrays only. Date / Map / Set /
 *   typed arrays / Buffer / function / etc. are not recursed into:
 *   cipherstash envelopes are user data and would not normally embed
 *   inside these host containers; if a future caller needs to bulk-
 *   decrypt envelopes inside such a container they extract them into a
 *   plain row first. The narrow scope keeps the walker`s behavior
 *   trivially predictable and avoids the cycle / iterator / lazy-eval
 *   surface those exotic types bring.
 * - Cycle-safe via a `WeakSet` of visited objects/arrays; the same
 *   envelope appearing in N positions is collected once.
 * - Skips envelopes whose plaintext slot is already populated
 *   (write-side envelopes from `EncryptedString.from(plaintext)`, or
 *   read-side envelopes already materialized by a prior
 *   `decrypt()` / `decryptAll(...)`). The skip means a re-run is a
 *   no-op and a mixed write/read row tree only round-trips for the
 *   envelopes that need it.
 *
 * **Grouping**. Envelopes are grouped by `(sdk, table, column)` —
 * routing key plus the envelope handle`s SDK reference. The SDK split
 * preserves the per-tenant SDK isolation `runtime.ts`'s docblock spells
 * out: each tenant constructs its own runtime descriptor with its own
 * SDK so per-tenant key material never crosses runtimes. Envelopes from
 * different tenants happening to share `(table, column)` therefore
 * still receive separate `bulkDecrypt` calls.
 *
 * **Cancellation**. `opts.signal` is forwarded by identity to every
 * `bulkDecrypt` call via `ifDefined` — the same shape the bulk-encrypt
 * middleware and `EncryptedString.decrypt({ signal? })` use. The
 * walker also races each SDK promise against `opts.signal` via
 * `raceCipherstashAbort` so an abort surfaces `RUNTIME.ABORTED
 * { phase: 'decrypt-all' }` promptly even when the SDK body itself
 * ignores the signal. A pre-check before the first SDK round-trip
 * short-circuits when the signal is already aborted at entry; the
 * no-envelopes-reachable fast path returns immediately without
 * observing the signal.
 */

import { ifDefined } from '@prisma-next/utils/defined';
import { checkCipherstashAborted, raceCipherstashAbort } from './abort';
import { EncryptedEnvelopeBase, isHandleDecrypted } from './envelope-base';
import type { CipherstashRoutingKey, CipherstashSdk } from './sdk';

export interface DecryptAllOptions {
  readonly signal?: AbortSignal;
}

interface BulkDecryptTarget {
  readonly envelope: EncryptedEnvelopeBase<unknown>;
  readonly ciphertext: unknown;
  readonly sdk: CipherstashSdk;
  readonly routingKey: CipherstashRoutingKey;
}

/**
 * Walk a result set and bulk-decrypt every cipherstash envelope (any
 * `EncryptedEnvelopeBase` subclass) reachable from it. After the
 * returned promise resolves, every touched envelope's `decrypt()`
 * returns the cached plaintext synchronously without consulting the
 * SDK. Heterogeneous result sets are supported — envelopes of
 * different concrete types (e.g. `EncryptedString` and
 * `EncryptedDate` reachable from the same row) are grouped by
 * `(sdk, table, column)` and the SDK's polymorphic `bulkDecrypt`
 * return is narrowed per envelope through each subclass's
 * {@link EncryptedEnvelopeBase.parseDecryptedValue} hook.
 *
 * The walker is a no-op when no envelopes are reachable (returns
 * without making any SDK call), so it is cheap to call defensively
 * after queries that may or may not contain encrypted columns.
 */
export async function decryptAll(rows: unknown, opts?: DecryptAllOptions): Promise<void> {
  const targets = collectTargets(rows);
  if (targets.length === 0) {
    return;
  }
  const groups = groupTargets(targets);
  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;
    const ciphertexts = group.map((t) => t.ciphertext);
    checkCipherstashAborted(opts?.signal, 'decrypt-all');
    const plaintexts = await raceCipherstashAbort(
      first.sdk.bulkDecrypt({
        routingKey: first.routingKey,
        ciphertexts,
        ...ifDefined('signal', opts?.signal),
      }),
      opts?.signal,
      'decrypt-all',
    );
    if (plaintexts.length !== group.length) {
      throw new Error(
        `cipherstash decryptAll: SDK returned ${plaintexts.length} plaintexts ` +
          `for routing key (${first.routingKey.table}, ${first.routingKey.column}) ` +
          `but ${group.length} were requested.`,
      );
    }
    for (let i = 0; i < group.length; i++) {
      const target = group[i];
      const plaintext = plaintexts[i];
      if (!target) continue;
      if (plaintext === undefined) {
        throw new Error(
          `cipherstash decryptAll: SDK returned undefined plaintext at index ${i} ` +
            `for routing key (${target.routingKey.table}, ${target.routingKey.column}). ` +
            'A missing plaintext indicates the SDK could not decrypt this envelope; ' +
            'silently skipping it would leave the caller with an envelope that still ' +
            'reports as not-yet-decrypted, so we surface the failure here instead.',
        );
      }
      // The SDK's `bulkDecrypt` returns `ReadonlyArray<unknown>`;
      // narrowing to each envelope's `T` is the per-subclass
      // responsibility. `applyDecryptedSdkResult` is a static member
      // on the base class (TS's class-bounded-friend convention) that
      // dispatches through the envelope's own `parseDecryptedValue`
      // hook (e.g. `EncryptedDate` coerces strings/numbers/Date
      // instances to a `Date`) and writes the narrowed plaintext into
      // the handle's cache slot. Heterogeneous groups are not possible
      // — every cell in a `(sdk, table, column)` group has the same
      // codec id, hence the same envelope subclass — but dynamic
      // dispatch still keeps the call site agnostic.
      EncryptedEnvelopeBase.applyDecryptedSdkResult(target.envelope, plaintext);
    }
  }
}

function collectTargets(root: unknown): BulkDecryptTarget[] {
  const targets: BulkDecryptTarget[] = [];
  const seenObjects = new WeakSet<object>();
  const seenEnvelopes = new WeakSet<EncryptedEnvelopeBase<unknown>>();
  visit(root, seenObjects, (envelope) => {
    if (seenEnvelopes.has(envelope)) return;
    seenEnvelopes.add(envelope);
    if (isHandleDecrypted(envelope)) return;
    const handle = envelope.expose();
    if (handle.table === undefined || handle.column === undefined) {
      throw new Error(
        'cipherstash decryptAll: envelope is missing (table, column) routing context. ' +
          'Read-side envelopes constructed via codec.decode always carry routing context; ' +
          'this typically means the envelope was constructed manually outside the codec path.',
      );
    }
    if (handle.sdk === undefined) {
      throw new Error(
        'cipherstash decryptAll: envelope is missing the SDK reference needed to decrypt. ' +
          'Read-side envelopes constructed via codec.decode always carry an SDK reference; ' +
          'this typically means the envelope was constructed manually outside the codec path.',
      );
    }
    targets.push({
      envelope,
      ciphertext: handle.ciphertext,
      sdk: handle.sdk,
      routingKey: { table: handle.table, column: handle.column },
    });
  });
  return targets;
}

function visit(
  value: unknown,
  seen: WeakSet<object>,
  found: (envelope: EncryptedEnvelopeBase<unknown>) => void,
): void {
  if (value === null || value === undefined) return;
  if (value instanceof EncryptedEnvelopeBase) {
    found(value);
    return;
  }
  if (typeof value !== 'object') return;
  if (seen.has(value)) return;
  // Walker is intentionally scoped to plain arrays + plain objects.
  // Date / Map / Set / typed arrays / Buffer / Error / class instances
  // are passed over so the walker`s shape stays trivially predictable
  // and immune to host-object iterator surprises.
  if (Array.isArray(value)) {
    seen.add(value);
    for (const item of value) {
      visit(item, seen, found);
    }
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  seen.add(value);
  for (const key of Object.keys(value)) {
    visit((value as Record<string, unknown>)[key], seen, found);
  }
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function groupTargets(targets: ReadonlyArray<BulkDecryptTarget>): Map<string, BulkDecryptTarget[]> {
  // Group by `(sdk identity, table, column)`. The SDK identity portion
  // of the key uses a per-SDK index issued on first encounter so
  // grouping never depends on object reference equality colliding
  // accidentally (different SDK instances always partition into
  // different groups even if their `(table, column)` matches).
  const sdkIndex = new Map<CipherstashSdk, number>();
  const groups = new Map<string, BulkDecryptTarget[]>();
  for (const target of targets) {
    let idx = sdkIndex.get(target.sdk);
    if (idx === undefined) {
      idx = sdkIndex.size;
      sdkIndex.set(target.sdk, idx);
    }
    const id = `${idx}\u0000${target.routingKey.table}\u0000${target.routingKey.column}`;
    let group = groups.get(id);
    if (!group) {
      group = [];
      groups.set(id, group);
    }
    group.push(target);
  }
  return groups;
}
