export interface RlsPolicyWireName {
  /** The user-supplied part before the `_<8hex>` suffix. */
  readonly prefix: string;
  /** The 8-lowercase-hex content-hash suffix. */
  readonly hash: string;
}

const WIRE_NAME_PATTERN = /^(.+)_([0-9a-f]{8})$/;

/**
 * Assembles an RLS policy wire name from its user-supplied prefix and its
 * 8-hex content-hash suffix. This module owns the `<prefix>_<hash>` format
 * on both sides — construction here and parsing in
 * {@link parseRlsPolicyWireName} — so the two never drift.
 */
export function formatRlsPolicyWireName(prefix: string, hash: string): string {
  return `${prefix}_${hash}`;
}

/**
 * Splits an RLS policy wire name (`<prefix>_<8hex>`) into its prefix and
 * content-hash suffix. Returns `undefined` when the name does not follow the
 * wire-name shape (e.g. a policy created outside the toolchain) — callers
 * treat such names as all-prefix. Consumed by introspection (prefix
 * extraction) and by rename pairing (same hash, different prefix).
 */
export function parseRlsPolicyWireName(name: string): RlsPolicyWireName | undefined {
  const match = WIRE_NAME_PATTERN.exec(name);
  const prefix = match?.[1];
  const hash = match?.[2];
  if (prefix === undefined || hash === undefined) return undefined;
  return { prefix, hash };
}
