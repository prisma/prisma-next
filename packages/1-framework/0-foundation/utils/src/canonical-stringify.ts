/**
 * Produces a deterministic, JSON-like string representation of a value.
 *
 * Designed for use as a stable identity / cache key. Two values that are
 * structurally equivalent — regardless of object key insertion order —
 * produce the same string. Two values that differ in any meaningful way
 * (including types that JSON would conflate, like `BigInt(1)` vs `1`)
 * produce different strings.
 *
 * Supported inputs:
 * - `null`, `undefined` (distinguishable: `null` → `"null"`, `undefined` → `"undefined"`)
 * - `boolean`, `string`, `number` (including `NaN`, `Infinity`, `-Infinity`)
 * - `bigint` (suffixed with `n` to disambiguate from `number`)
 * - `Date` (tagged + ISO string)
 * - `Buffer` / `Uint8Array` (tagged + hex-encoded)
 * - Arrays (order-preserving)
 * - Plain objects (key-sorted)
 *
 * Throws on `function`, `symbol`, and circular references.
 *
 * The output format is intentionally not JSON: the type tags and BigInt
 * suffix mean it cannot be round-tripped via `JSON.parse`. The goal is
 * keying, not serialization.
 *
 * @example
 * ```typescript
 * canonicalStringify({ a: 1, b: 2 }) === canonicalStringify({ b: 2, a: 1 })
 * // → true
 *
 * canonicalStringify(1n) !== canonicalStringify(1)
 * // → true
 * ```
 */
export function canonicalStringify(value: unknown): string {
  return write(value, new Set());
}

function write(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return writeNumber(value);
    case 'bigint':
      return `${value.toString()}n`;
    case 'string':
      return JSON.stringify(value);
    case 'function':
      throw new TypeError('canonicalStringify: functions are not supported');
    case 'symbol':
      throw new TypeError('canonicalStringify: symbols are not supported');
  }

  // From here, value is a non-null object.
  const obj = value as object;

  if (seen.has(obj)) {
    throw new TypeError('canonicalStringify: circular reference detected');
  }
  seen.add(obj);
  try {
    if (value instanceof Date) {
      return `Date(${value.toISOString()})`;
    }

    // `Buffer` is a `Uint8Array` subclass; this branch covers both.
    if (value instanceof Uint8Array) {
      return `Bytes(${bytesToHex(value)})`;
    }

    if (Array.isArray(value)) {
      const parts = value.map((item) => write(item, seen));
      return `[${parts.join(',')}]`;
    }

    return writePlainObject(obj as Record<string, unknown>, seen);
  } finally {
    seen.delete(obj);
  }
}

function writeNumber(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Number.POSITIVE_INFINITY) return 'Infinity';
  if (value === Number.NEGATIVE_INFINITY) return '-Infinity';
  // Distinguish `+0` from `-0` so they hash differently.
  if (value === 0 && 1 / value === Number.NEGATIVE_INFINITY) return '-0';
  return String(value);
}

function writePlainObject(obj: Record<string, unknown>, seen: Set<object>): string {
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const key of keys) {
    parts.push(`${JSON.stringify(key)}:${write(obj[key], seen)}`);
  }
  return `{${parts.join(',')}}`;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] as number;
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}
