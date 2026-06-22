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
    const ch = sql.charAt(i);

    if (ch === "'") {
      // Single-quoted string literal — copy verbatim (preserving case), handle '' escapes.
      // After the closing quote, strip any immediately-following `::text` annotation
      // that Postgres adds to string literals when reprinting predicate bodies.
      out += ch;
      i++;
      while (i < sql.length) {
        const sc = sql.charAt(i);
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
 * Returns true when `inner` contains a top-level binary operator — i.e. an
 * operator not nested inside parens or a string literal. Used to decide
 * whether `(inner)::type` can safely have its parens stripped.
 *
 * `::` binds tighter than every binary operator, so `(a OR b)::text` means
 * `(a OR (b::text))` without the parens — semantically different. When
 * `inner` is atomic (identifier, literal, or a function call), the parens add
 * nothing and can be dropped safely.
 */
function hasTopLevelBinaryOperator(inner: string): boolean {
  let depth = 0;
  let i = 0;
  while (i < inner.length) {
    const ch = inner.charAt(i);

    if (ch === "'") {
      // Skip string literal — its contents are not operators.
      i++;
      while (i < inner.length) {
        if (inner[i] === "'") {
          i++;
          if (inner[i] === "'") {
            i++;
          } else {
            break;
          }
        } else {
          i++;
        }
      }
      continue;
    }

    if (ch === '(') {
      depth++;
      i++;
      continue;
    }
    if (ch === ')') {
      depth--;
      i++;
      continue;
    }

    if (depth > 0) {
      i++;
      continue;
    }

    // At depth 0, check for binary operators.
    // Single-char symbolic operators: = < > + - * / % | &
    if (/[=<>+\-*/%|&]/.test(ch)) {
      return true;
    }

    // Word-boundary operators: AND, OR, NOT, IS, IN, LIKE, BETWEEN, ILIKE
    // (sql has already been lowercased by this point)
    if (/[a-z]/.test(ch)) {
      const wordMatch = inner.slice(i).match(/^(and|or|not|is|in|like|ilike|between)\b/);
      if (wordMatch) {
        return true;
      }
    }

    i++;
  }
  return false;
}

/**
 * Strips redundant grouping parentheses around **atomic** cast operands only:
 * `(expr)::type` → `expr::type` when `expr` contains no top-level binary
 * operator (i.e. is a single identifier, literal, or function call).
 *
 * When `expr` contains a top-level operator (e.g. `a OR b`, `amount + tax`),
 * the parens are semantically meaningful — `::` binds tighter than binary
 * operators, so stripping them would change the expression's meaning — and
 * are left in place.
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
        const prevChar = out.length > 0 ? out.charAt(out.length - 1) : '';
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
            const inner = s.slice(i + 1, j - 1);
            // Only strip when the inner expression is atomic — no top-level
            // binary operator. When inner has a top-level operator, the parens
            // are semantically meaningful (:: binds tighter than any binary op).
            if (!hasTopLevelBinaryOperator(inner)) {
              out += inner;
              i = j;
              changed = true;
              continue;
            }
          }
        }
      }
      out += s.charAt(i);
      i++;
    }
    s = out;
  }
  return s;
}

/**
 * Returns true when `inner` (already lowercased) contains a top-level boolean
 * operator — AND, OR, or NOT — at depth 0. String literals are skipped so
 * keywords inside quoted values are not counted. Used to decide whether
 * `(inner)` is semantically required (when inner has a boolean operator) or
 * can safely be stripped.
 */
function hasTopLevelBooleanOperator(inner: string): boolean {
  let depth = 0;
  let i = 0;
  while (i < inner.length) {
    const ch = inner.charAt(i);
    if (ch === "'") {
      i++;
      while (i < inner.length) {
        if (inner[i] === "'") {
          i++;
          if (inner[i] === "'") i++;
          else break;
        } else {
          i++;
        }
      }
      continue;
    }
    if (ch === '(') {
      depth++;
      i++;
      continue;
    }
    if (ch === ')') {
      depth--;
      i++;
      continue;
    }
    if (depth === 0 && /[a-z]/.test(ch)) {
      if (inner.slice(i).match(/^(and|or|not)\b/)) return true;
    }
    i++;
  }
  return false;
}

/**
 * Strips parens that Postgres adds around each operand of a top-level AND/OR
 * chain when reprinting compound predicates. For example, Postgres reprints
 * `a = 1 AND b IS NULL` as `(a = 1) AND (b IS NULL)`. This function removes
 * those redundant grouping parens so authored and introspected predicates
 * hash identically.
 *
 * Safety rules:
 * - Only strips `(inner)` when `inner` has no top-level boolean operators
 *   (AND/OR/NOT) — preserves `(A OR B) AND C` since those parens are
 *   semantically required.
 * - Skips `(...)::` — those are cast expressions handled by
 *   `stripRedundantCastParens`.
 * - Skips function-call parens (where `(` is preceded by an identifier char).
 * - Skips parens inside string literals.
 *
 * Works on already-lowercased, whitespace-collapsed input.
 */
function stripTopLevelAndParens(sql: string): string {
  let changed = true;
  let s = sql;
  while (changed) {
    changed = false;
    let out = '';
    let i = 0;
    while (i < s.length) {
      // Pass string literals through verbatim — parens inside are data.
      if (s[i] === "'") {
        out += s.charAt(i);
        i++;
        while (i < s.length) {
          out += s.charAt(i);
          if (s[i] === "'") {
            i++;
            if (s[i] === "'") {
              out += s.charAt(i);
              i++;
            } else {
              break;
            }
          } else {
            i++;
          }
        }
        continue;
      }

      if (s[i] === '(') {
        const prevChar = out.length > 0 ? out.charAt(out.length - 1) : '';
        const isPrecedingIdentChar = prevChar !== '' && /[a-z0-9_$"]/i.test(prevChar);
        if (!isPrecedingIdentChar) {
          // Find matching close paren, respecting string literals.
          let depth = 1;
          let j = i + 1;
          while (j < s.length && depth > 0) {
            if (s[j] === "'") {
              j++;
              while (j < s.length) {
                if (s[j] === "'") {
                  j++;
                  if (s[j] === "'") j++;
                  else break;
                } else {
                  j++;
                }
              }
              continue;
            }
            if (s[j] === '(') depth++;
            else if (s[j] === ')') depth--;
            j++;
          }
          if (depth === 0) {
            const inner = s.slice(i + 1, j - 1).trim();
            // Do NOT strip if immediately followed by `::` — cast expressions
            // like `(amount + tax)::int` are handled by stripRedundantCastParens.
            const followedByCast = s.slice(j, j + 2) === '::';
            // Only strip when inner has no top-level boolean operators:
            // (A AND B), (A OR B), (NOT A) are semantically significant parens.
            if (!followedByCast && !hasTopLevelBooleanOperator(inner)) {
              out += inner;
              i = j;
              changed = true;
              continue;
            }
          }
        }
      }

      out += s.charAt(i);
      i++;
    }
    s = out.replace(/\s+/g, ' ').trim();
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
 * 6. Strip redundant parens Postgres adds around AND/OR operands when
 *    reprinting compound predicates — `(a = 1) AND (b IS NULL)` →
 *    `a = 1 AND b IS NULL`. Only strips when inner has no top-level OR
 *    (preserves semantics: `(A OR B) AND C` keeps its parens).
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
  result = stripTopLevelAndParens(result);

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
