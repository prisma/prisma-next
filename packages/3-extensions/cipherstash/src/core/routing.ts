/**
 * Routing-key derivation for cipherstash bulk operations.
 *
 * Per Project 1's standing decision (umbrella spec § Open items 5),
 * the routing key is derived from the envelope handle's `(table, column)`
 * — there is no per-column override surface. Every cipherstash envelope
 * passing through `bulkEncryptMiddleware` (and, in M4, `decryptAll`)
 * carries `(table, column)` on its handle, populated by the bulk-encrypt
 * middleware's AST walk before the bulk-encrypt phase begins.
 *
 * `groupByRoutingKey` produces one homogeneous group per `(table, column)`
 * pair so each `bulkEncrypt` call serves a single routing key — matching
 * the reference SDK's `bulkEncrypt(plaintexts, { column, table })` shape
 * (see `reference/cipherstash/.../ffi/index.ts:386-391`). The
 * heterogeneous `bulkEncryptModels` shape is a Project 2+ optimization.
 */

import type { EncryptedString } from './envelope';
import { getInternalHandle } from './envelope';
import type { CipherstashRoutingKey } from './sdk';

/**
 * Per-target context the bulk-encrypt middleware accumulates while
 * walking `params.entries()`. Each target carries the envelope, its
 * routing key (derived from the handle), the plaintext to encrypt,
 * and the param-ref handle the mutator yielded so the post-encrypt
 * `replaceValues` write-back can find the slot.
 */
export interface BulkEncryptTarget<TRef = unknown> {
  readonly ref: TRef;
  readonly plaintext: string;
  readonly envelope: EncryptedString;
  readonly routingKey: CipherstashRoutingKey;
}

/**
 * Stable string key used to group targets by their `(table, column)`
 * routing key. Exported for tests; not part of the package's public
 * surface.
 */
export function routingKeyId(routingKey: CipherstashRoutingKey): string {
  return `${routingKey.table}\u0000${routingKey.column}`;
}

/**
 * Read the routing key from an envelope's internal handle. Throws if
 * the handle's `(table, column)` slots are unset — which happens when
 * the bulk-encrypt middleware's AST-walk did not see this envelope
 * (typical cause: the envelope was passed in a context the AST walk
 * does not yet handle, e.g. a raw-SQL plan with no `InsertAst` /
 * `UpdateAst` arm). The throw is the same diagnostic shape the codec
 * uses for missing ciphertext: it points at the workflow that should
 * have populated the slot.
 */
export function getRoutingKey(envelope: EncryptedString): CipherstashRoutingKey {
  const handle = getInternalHandle(envelope);
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
 * Order preservation: within each group, targets keep the order in
 * which they were collected from `params.entries()` — which is the
 * canonical ParamRef order the renderer's `$N` index map and the
 * encode-side walk both consume. Iteration order across groups follows
 * the order the routing keys were first observed in the input.
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
