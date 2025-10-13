/**
 * Canonical JSON serialization for deterministic hashing
 * Recursively sorts object keys and ensures consistent output
 */

export function canonicalJSONStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(sortKeysDeep);
  }
  
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeysDeep(obj[key]);
    }
    return out;
  }
  
  return obj;
}
