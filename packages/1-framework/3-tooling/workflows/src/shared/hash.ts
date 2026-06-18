import { createHash } from 'node:crypto';

export function stableStringify(value: unknown, space?: number): string {
  return JSON.stringify(sortJson(value), null, space);
}

export function contentHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

export function contentHashVersion(sourceHash: string): number {
  const parts = sourceHash.split(':');
  const hex = parts[parts.length - 1] ?? sourceHash;
  const parsed = Number.parseInt(hex.slice(0, 8), 16);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  return (parsed % 2_147_483_647) + 1;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    const record = Object.fromEntries(Object.entries(value));
    for (const key of Object.keys(value).sort()) {
      out[key] = sortJson(record[key]);
    }
    return out;
  }
  return value;
}
