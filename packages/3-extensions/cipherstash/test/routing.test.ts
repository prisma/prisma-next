/**
 * Routing-key derivation for cipherstash bulk operations — T2.4
 * partial / Decision 2 from `plan.md § Open items 5` (resolved
 * 2026-05-06): the routing key is `(table, column)` derived from the
 * envelope handle, with no per-column override surface.
 *
 * Tests cover:
 *   - `routingKeyId(...)` produces stable, collision-free string keys.
 *   - `getRoutingKey(envelope)` reads `(table, column)` from the
 *     envelope handle, throwing a routing-context diagnostic when the
 *     handle slots are unset (canonical "AST walk did not see this
 *     envelope" failure mode).
 *   - `groupByRoutingKey(targets)` collapses a homogeneous batch into
 *     one group, partitions a heterogeneous batch into per-key groups,
 *     and preserves within-group order (the canonical ParamRef order
 *     consumed by the renderer's `$N` index map and the encode-side
 *     metadata walk).
 */

import { describe, expect, it } from 'vitest';
import { EncryptedString, setHandleRoutingKey } from '../src/execution/envelope';
import {
  type BulkEncryptTarget,
  getRoutingKey,
  groupByRoutingKey,
  routingKeyId,
} from '../src/execution/routing';

function makeTarget(plaintext: string, table: string, column: string): BulkEncryptTarget {
  const envelope = EncryptedString.from(plaintext);
  setHandleRoutingKey(envelope, table, column);
  return {
    ref: Symbol(`${table}.${column}`),
    plaintext,
    envelope,
    routingKey: { table, column },
  };
}

describe('routingKeyId — stable string identity per (table, column)', () => {
  it('produces the same id for equal (table, column) pairs', () => {
    expect(routingKeyId({ table: 'user', column: 'email' })).toBe(
      routingKeyId({ table: 'user', column: 'email' }),
    );
  });

  it('produces distinct ids when the table or column differs', () => {
    expect(routingKeyId({ table: 'user', column: 'email' })).not.toBe(
      routingKeyId({ table: 'user', column: 'username' }),
    );
    expect(routingKeyId({ table: 'user', column: 'email' })).not.toBe(
      routingKeyId({ table: 'admin', column: 'email' }),
    );
  });

  it('does not collide on names that share a literal concatenation', () => {
    const a = routingKeyId({ table: 'a', column: 'bc' });
    const b = routingKeyId({ table: 'ab', column: 'c' });
    expect(a).not.toBe(b);
  });
});

describe('getRoutingKey — reads (table, column) from envelope handle', () => {
  it('returns the handle-stamped routing key', () => {
    const envelope = EncryptedString.from('alice@example.com');
    setHandleRoutingKey(envelope, 'user', 'email');
    expect(getRoutingKey(envelope)).toEqual({ table: 'user', column: 'email' });
  });

  it('throws with a routing-context diagnostic when the handle is unstamped', () => {
    const envelope = EncryptedString.from('alice@example.com');
    expect(() => getRoutingKey(envelope)).toThrow(/routing context/);
  });
});

describe('groupByRoutingKey — one group per (table, column)', () => {
  it('collapses N targets with one routing key into a single group', () => {
    const targets = Array.from({ length: 5 }, (_, i) => makeTarget(`u${i}@x`, 'user', 'email'));
    const groups = groupByRoutingKey(targets);
    expect(groups.size).toBe(1);
    const only = [...groups.values()][0];
    expect(only).toHaveLength(5);
    expect(only?.map((t) => t.plaintext)).toEqual(['u0@x', 'u1@x', 'u2@x', 'u3@x', 'u4@x']);
  });

  it('partitions targets by routing key, preserving within-group order', () => {
    const targets: BulkEncryptTarget[] = [
      makeTarget('a@x', 'user', 'email'),
      makeTarget('b@y', 'admin', 'email'),
      makeTarget('c@x', 'user', 'email'),
      makeTarget('d@y', 'admin', 'email'),
      makeTarget('e@u', 'user', 'username'),
    ];
    const groups = groupByRoutingKey(targets);
    expect(groups.size).toBe(3);
    const userEmail = groups.get(routingKeyId({ table: 'user', column: 'email' }));
    const adminEmail = groups.get(routingKeyId({ table: 'admin', column: 'email' }));
    const userUsername = groups.get(routingKeyId({ table: 'user', column: 'username' }));
    expect(userEmail?.map((t) => t.plaintext)).toEqual(['a@x', 'c@x']);
    expect(adminEmail?.map((t) => t.plaintext)).toEqual(['b@y', 'd@y']);
    expect(userUsername?.map((t) => t.plaintext)).toEqual(['e@u']);
  });

  it('returns an empty map for empty input', () => {
    expect(groupByRoutingKey([]).size).toBe(0);
  });
});
