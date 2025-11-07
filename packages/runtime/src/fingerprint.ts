import { createHash } from 'node:crypto';

const STRING_LITERAL_REGEX = /'(?:''|[^'])*'/g;
const NUMERIC_LITERAL_REGEX = /\b\d+(?:\.\d+)?\b/g;
const WHITESPACE_REGEX = /\s+/g;

export function computeSqlFingerprint(sql: string): string {
  const withoutStrings = sql.replace(STRING_LITERAL_REGEX, '?');
  const withoutNumbers = withoutStrings.replace(NUMERIC_LITERAL_REGEX, '?');
  const normalized = withoutNumbers.replace(WHITESPACE_REGEX, ' ').trim().toLowerCase();

  const hash = createHash('sha256').update(normalized).digest('hex');
  return `sha256:${hash}`;
}
