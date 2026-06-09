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
 * Strips SQL line/block comments, lowercases syntax outside single-quoted
 * string literals, and strips Postgres-added `::text` casts from string
 * literal positions. Literal contents are copied verbatim — their case is
 * data, not syntax. Uses a minimal char-by-char scanner.
 *
 * Postgres adds `'literal'::text` annotations to string literals when
 * reprinting policy bodies; we strip the `::text` suffix so authored and
 * introspected forms hash identically.
 */
function stripCommentsAndLowercase(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;

    if (ch === "'") {
      // Single-quoted string literal — copy verbatim (preserving case), handle '' escapes.
      // After the closing quote, strip any immediately-following `::text` annotation
      // that Postgres adds to string literals when reprinting predicate bodies.
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
            // End of literal — strip a trailing `::text` cast if present.
            // We match case-insensitively (lowercased form: `::text`).
            const rest = sql.slice(i).toLowerCase();
            if (rest.startsWith('::text')) {
              // Consume `::text` without emitting it; the next char may be
              // any delimiter (space, paren, comma, end-of-string).
              const afterCast = rest.slice(6);
              if (
                afterCast.length === 0 ||
                /^[\s),]/.test(afterCast) ||
                afterCast.startsWith('::')
              ) {
                i += 6;
              }
            }
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
 * Normalizes Postgres type cast aliases to their shortest canonical form.
 * Postgres expands authored shorthands (`::int`) to full names (`::integer`)
 * when reprinting policy bodies. We normalize back to the shorthand so
 * authored and introspected predicates produce the same hash.
 *
 * Only replaces word-boundary-terminated cast tokens to avoid false matches
 * inside identifiers or string literals (those are already absent — this
 * runs on the output of `stripCommentsAndLowercase`, so literals are gone).
 */
function normalizeCastAliases(sql: string): string {
  return sql
    .replace(/::integer\b/g, '::int')
    .replace(/::boolean\b/g, '::bool')
    .replace(/::bigint\b/g, '::int8')
    .replace(/::character varying\b/g, '::varchar')
    .replace(/::double precision\b/g, '::float8');
}

/**
 * Strips redundant grouping parentheses that Postgres adds around cast
 * operands, i.e. `(expr)::type` → `expr::type`. This is semantically
 * equivalent in SQL because the `::` operator already binds to its
 * immediate left argument regardless of parentheses.
 *
 * Only removes `(...)::` where the `(` is preceded by a non-identifier
 * character (start-of-string, space, or an operator). This avoids stripping
 * function-call argument lists like `func(args)::type`.
 */
function stripRedundantCastParens(sql: string): string {
  let changed = true;
  let s = sql;
  while (changed) {
    changed = false;
    let out = '';
    let i = 0;
    while (i < s.length) {
      if (s[i] === '(') {
        // Only treat as a grouping paren (not a function-call paren) if the
        // preceding character is not an identifier char.
        const prevChar = out.length > 0 ? out[out.length - 1] : '';
        const isPrecedingIdentChar = prevChar !== '' && /[a-z0-9_$"]/i.test(prevChar);
        if (!isPrecedingIdentChar) {
          // Find the matching close paren.
          let depth = 1;
          let j = i + 1;
          while (j < s.length && depth > 0) {
            if (s[j] === '(') depth++;
            else if (s[j] === ')') depth--;
            j++;
          }
          // j now points one past the closing ')'.
          // Check if the next chars are '::'.
          if (depth === 0 && s.slice(j, j + 2) === '::') {
            // Remove the outer parens — emit the inner content directly.
            out += s.slice(i + 1, j - 1);
            i = j;
            changed = true;
            continue;
          }
        }
      }
      out += s[i]!;
      i++;
    }
    s = out;
  }
  return s;
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
 *    outside string literals. Strip `::text` casts Postgres adds to string
 *    literals when reprinting predicate bodies. Literal contents are copied
 *    verbatim — case inside `'...'` is data, not syntax.
 * 2. Collapse runs of whitespace to a single space and trim.
 * 3. Remove fully-enclosing outer paren pairs (repeated until none remain).
 * 4. Strip redundant parentheses around cast operands (`(expr)::type` →
 *    `expr::type`), which Postgres adds when reprinting expressions.
 * 5. Normalize Postgres type cast aliases to their shorthand form
 *    (`::integer` → `::int`, `::boolean` → `::bool`, etc.) so authored and
 *    introspected predicates hash identically.
 *
 * The normalizer is a stability commitment: any change re-suffixes all wire names.
 */
export function normalizePredicate(sql: string): string {
  let result = stripCommentsAndLowercase(sql);
  result = result.replace(/\s+/g, ' ').trim();

  while (isOuterParenWrapped(result)) {
    result = result.slice(1, -1).trim();
  }

  result = stripRedundantCastParens(result);
  result = normalizeCastAliases(result);

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
