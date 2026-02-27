/**
 * Extension ID for ParadeDB pg_search.
 */
export const PARADEDB_EXTENSION_ID = 'paradedb' as const;

/**
 * Built-in ParadeDB tokenizer IDs.
 * These correspond to the `pdb.*` casting syntax in `CREATE INDEX ... USING bm25`.
 */
export const TOKENIZER = {
  /** Default. Splits on Unicode word boundaries (UAX #29). Lowercases. */
  UNICODE: 'unicode',
  /** Splits on non-alphanumeric characters. Lowercases. */
  SIMPLE: 'simple',
  /** Character n-grams of configurable length. */
  NGRAM: 'ngram',
  /** ICU Unicode standard segmentation. Multilingual. */
  ICU: 'icu',
  /** Regex-based tokenization. */
  REGEX_PATTERN: 'regex_pattern',
  /** Splits on whitespace, punctuation, camelCase, snake_case. */
  SOURCE_CODE: 'source_code',
  /** No splitting. Exact match, sort, and aggregation. */
  LITERAL: 'literal',
  /** Literal + lowercase + token filters. */
  LITERAL_NORMALIZED: 'literal_normalized',
  /** Whitespace splitting + lowercase. */
  WHITESPACE: 'whitespace',
  /** CJK-aware word segmentation. */
  CHINESE_COMPATIBLE: 'chinese_compatible',
  /** Chinese segmentation via Jieba. */
  JIEBA: 'jieba',
  /** Japanese/Korean/Chinese via Lindera. */
  LINDERA: 'lindera',
} as const;

export type TokenizerId = (typeof TOKENIZER)[keyof typeof TOKENIZER];
