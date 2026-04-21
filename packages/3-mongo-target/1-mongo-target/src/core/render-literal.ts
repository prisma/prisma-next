/**
 * Shared literal-rendering helpers for TypeScript source emission.
 *
 * Used by `MigrationTsExpression` subclasses (concrete `OpFactoryCall`
 * classes) to convert literal argument values — strings, numbers,
 * booleans, arrays, plain objects — into TypeScript source. Pretty-prints
 * with a soft 80-column single-line budget, falling back to a block form
 * otherwise. Unknown values fall through to `String(value)`.
 *
 * Package-private to the Mongo target.
 */
export function renderLiteral(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v) => renderLiteral(v));
    const singleLine = `[${items.join(', ')}]`;
    if (singleLine.length <= 80) return singleLine;
    return `[\n${items.map((i) => `  ${i}`).join(',\n')},\n]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return '{}';
    const items = entries.map(([k, v]) => `${renderKey(k)}: ${renderLiteral(v)}`);
    const singleLine = `{ ${items.join(', ')} }`;
    if (singleLine.length <= 80) return singleLine;
    return `{\n${items.map((i) => `  ${i}`).join(',\n')},\n}`;
  }
  return String(value);
}

export function renderKey(key: string): string {
  if (key === '__proto__') return JSON.stringify(key);
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}
