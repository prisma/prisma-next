import type { MongoSchemaIndex } from './schema-index';

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i++) {
      const aKey = aKeys[i];
      const bKey = bKeys[i];
      if (aKey !== bKey) return false;
      if (!deepEqual(aObj[aKey], bObj[aKey])) return false;
    }
    return true;
  }

  return false;
}

export function indexesEquivalent(a: MongoSchemaIndex, b: MongoSchemaIndex): boolean {
  if (a.keys.length !== b.keys.length) return false;
  for (let i = 0; i < a.keys.length; i++) {
    if (a.keys[i]!.field !== b.keys[i]!.field) return false;
    if (a.keys[i]!.direction !== b.keys[i]!.direction) return false;
  }
  if (a.unique !== b.unique) return false;
  if (a.sparse !== b.sparse) return false;
  if (a.expireAfterSeconds !== b.expireAfterSeconds) return false;
  return deepEqual(a.partialFilterExpression, b.partialFilterExpression);
}
