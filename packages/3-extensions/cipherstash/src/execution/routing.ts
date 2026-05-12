/**
 * Routing-key derivation for cipherstash bulk operations.
 *
 * The routing key is derived from the envelope handle's
 * `(table, column)` — there is no per-column override surface. Every
 * cipherstash envelope passing through `bulkEncryptMiddleware` (and
 * `decryptAll`) carries `(table, column)` on its handle, populated by
 * the middleware's AST walk before the bulk-encrypt phase begins.
 *
 * `groupByRoutingKey` produces one homogeneous group per
 * `(table, column)` pair so each `bulkEncrypt` call serves a single
 * routing key — matching the SDK's
 * `bulkEncrypt({ routingKey, values, signal })` shape. Heterogeneous
 * batching is a future optimization.
 */

import type { EncryptedEnvelopeBase } from './envelope-base';
import type { CipherstashRoutingKey } from './sdk';

/**
 * Per-target context the bulk-encrypt middleware accumulates while
 * walking `params.entries()`. Each target carries the envelope, its
 * routing key (derived from the handle), the plaintext to encrypt, and
 * the param-ref handle the mutator yielded so the post-encrypt
 * `replaceValues` write-back can find the slot.
 *
 * `plaintext` types as `unknown` because the bulk-encrypt path is
 * polymorphic across every cipherstash codec (string, double, bigint,
 * date, boolean, json — each with its own `T`); the SDK's
 * `bulkEncrypt({ values: ReadonlyArray<unknown>, ... })` shape is
 * already the polymorphic surface (D1), and homogeneity within a
 * `(table, column)` group means narrower per-cell typing is not
 * needed for batching correctness.
 */
export interface BulkEncryptTarget<TRef = unknown> {
  readonly ref: TRef;
  readonly plaintext: unknown;
  readonly envelope: EncryptedEnvelopeBase<unknown>;
  readonly routingKey: CipherstashRoutingKey;
}

/**
 * Stable string key used to group targets by their `(table, column)`
 * routing key. Exported for tests; not part of the package's public
 * surface. Uses a NUL byte as the separator so the id never collides
 * across pairs whose names happen to share a literal concatenation
 * (e.g. `(a, bc)` vs `(ab, c)`).
 */
export function routingKeyId(routingKey: CipherstashRoutingKey): string {
  return `${routingKey.table}\u0000${routingKey.column}`;
}

/**
 * Read the routing key from an envelope's internal handle. Throws if
 * the handle's `(table, column)` slots are unset — which happens when
 * the bulk-encrypt middleware's AST walk did not see this envelope
 * (typical cause: the envelope was passed in a context the AST walk
 * does not yet handle, e.g. a raw-SQL plan with no `InsertAst` /
 * `UpdateAst` arm). The throw matches the codec's
 * "missing ciphertext" diagnostic shape: it points at the workflow that
 * should have populated the slot.
 */
export function getRoutingKey(envelope: EncryptedEnvelopeBase<unknown>): CipherstashRoutingKey {
  const handle = envelope.expose();
  if (handle.table === undefined || handle.column === undefined) {
    throw new Error(
      'cipherstash bulk-encrypt: envelope has no (table, column) routing context. ' +
        'The bulk-encrypt middleware stamps routing context from the lowered AST ' +
        '(insert/update); raw-SQL plans embedding cipherstash envelopes must stamp ' +
        'routing context explicitly before execute.',
    );
  }
  return { table: handle.table, column: handle.column };
}

/**
 * Group bulk-encrypt targets by `(table, column)` routing key. Each
 * `Map` entry yields one homogeneous batch suitable for a single
 * `sdk.bulkEncrypt({ routingKey, values, signal })` call.
 *
 * Order preservation: within each group, targets keep the order they
 * were collected from `params.entries()` — which is the canonical
 * ParamRef order the renderer's `$N` index map and the encode-side walk
 * both consume. Iteration order across groups follows the order each
 * routing key was first observed in the input.
 */
export function groupByRoutingKey<TRef>(
  targets: ReadonlyArray<BulkEncryptTarget<TRef>>,
): Map<string, BulkEncryptTarget<TRef>[]> {
  const groups = new Map<string, BulkEncryptTarget<TRef>[]>();
  for (const target of targets) {
    const id = routingKeyId(target.routingKey);
    let group = groups.get(id);
    if (!group) {
      group = [];
      groups.set(id, group);
    }
    group.push(target);
  }
  return groups;
}
