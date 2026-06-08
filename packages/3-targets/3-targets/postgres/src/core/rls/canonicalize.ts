import { createHash } from 'node:crypto';

export type RlsPolicyOperation = 'select' | 'insert' | 'update' | 'delete' | 'all';

export interface ContentHashParts {
  readonly using?: string;
  readonly withCheck?: string;
  readonly roles: readonly string[];
  readonly operation: RlsPolicyOperation;
  readonly permissive: boolean;
}

/**
 * Strips SQL line/block comments and lowercases syntax outside single-quoted
 * string literals. Literal contents are copied verbatim — their case is data,
 * not syntax. Uses a minimal char-by-char scanner.
 */
function stripCommentsAndLowercase(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;

    if (ch === "'") {
      // Single-quoted string literal — copy verbatim (preserving case), handle '' escapes.
      out += ch;
      i++;
      while (i < sql.length) {
        const sc = sql[i]!;
        out += sc;
        i++;
        if (sc === "'") {
          if (sql[i] === "'") {
            out += sql[i];
            i++;
          } else {
            break;
          }
        }
      }
      continue;
    }

    if (ch === '-' && sql[i + 1] === '-') {
      i += 2;
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }

    if (ch === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    out += ch.toLowerCase();
    i++;
  }
  return out;
}

/**
 * Returns true when `sql` (already trimmed) is fully wrapped by the outermost
 * paren pair — i.e. the opening `(` at index 0 matches the closing `)` at
 * the last index.
 */
function isOuterParenWrapped(sql: string): boolean {
  if (sql.length < 2 || sql[0] !== '(' || sql[sql.length - 1] !== ')') return false;
  let depth = 0;
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')') {
      depth--;
      if (depth === 0 && i < sql.length - 1) return false;
    }
  }
  return depth === 0;
}

/**
 * Canonicalizes a SQL predicate body across Postgres's reformatting axes:
 *
 * 1. Strip line (`--`) and block (`/* *\/`) comments, lowercasing syntax
 *    outside string literals. Literal contents are copied verbatim — case
 *    inside `'...'` is data, not syntax.
 * 2. Collapse runs of whitespace to a single space and trim.
 * 3. Remove fully-enclosing outer paren pairs (repeated until none remain).
 *
 * The normalizer is a stability commitment: any change re-suffixes all wire names.
 */
export function normalizePredicate(sql: string): string {
  let result = stripCommentsAndLowercase(sql);
  result = result.replace(/\s+/g, ' ').trim();

  while (isOuterParenWrapped(result)) {
    result = result.slice(1, -1).trim();
  }

  return result;
}

/**
 * Returns the first 8 lowercase hex characters of the SHA-256 digest over the
 * canonical content tuple for an RLS policy:
 *
 *   [canonical(using), canonical(withCheck), sortedRoles, operation, permissive]
 *
 * Schema and table are excluded (they are orthogonal to policy equivalence).
 * Uses `JSON.stringify` for a deterministic encoding.
 */
export function computeContentHash(parts: ContentHashParts): string {
  const using = normalizePredicate(parts.using ?? '');
  const withCheck = normalizePredicate(parts.withCheck ?? '');
  const roles = [...new Set(parts.roles)].sort();
  const permissive = parts.permissive ? 'permissive' : 'restrictive';

  const tuple = JSON.stringify([using, withCheck, roles, parts.operation, permissive]);
  return createHash('sha256').update(tuple).digest('hex').slice(0, 8);
}
