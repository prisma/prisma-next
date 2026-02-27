import type { Bm25FieldConfig } from '@prisma-next/sql-contract/types';
import type { TokenizerId } from '../core/constants';

/**
 * Options for a BM25 text field (text, varchar columns).
 */
export type Bm25TextFieldOptions = {
  readonly tokenizer?: TokenizerId | (string & {});
  readonly stemmer?: string;
  readonly alias?: string;
  readonly remove_emojis?: boolean;
};

/**
 * Options for a BM25 JSON field (json, jsonb columns).
 */
export type Bm25JsonFieldOptions = {
  readonly tokenizer?: TokenizerId | (string & {});
  readonly alias?: string;
  /** Ngram-specific params when tokenizer is 'ngram'. */
  readonly min?: number;
  readonly max?: number;
};

/**
 * Options for a BM25 expression-based field.
 */
export type Bm25ExpressionFieldOptions = {
  readonly alias: string;
  readonly tokenizer?: TokenizerId | (string & {});
  readonly min?: number;
  readonly max?: number;
  readonly stemmer?: string;
  readonly pattern?: string;
};

type TokenizerConfig = {
  readonly tokenizer?: string;
  readonly tokenizerParams?: Record<string, unknown>;
};

/**
 * Typed BM25 field builders.
 * These produce `Bm25FieldConfig` objects for use in `bm25Index()`.
 */
export const bm25 = {
  /** Text field with optional tokenizer config. */
  text(column: string, opts?: Bm25TextFieldOptions): Bm25FieldConfig {
    return {
      column,
      ...buildTokenizerConfig(opts?.tokenizer, {
        stemmer: opts?.stemmer,
        remove_emojis: opts?.remove_emojis,
      }),
      ...(opts?.alias !== undefined && { alias: opts.alias }),
    };
  },

  /** Numeric field (filterable, sortable in BM25). */
  numeric(column: string): Bm25FieldConfig {
    return { column };
  },

  /** Boolean field. */
  boolean(column: string): Bm25FieldConfig {
    return { column };
  },

  /** JSON/JSONB field with optional tokenizer config. */
  json(column: string, opts?: Bm25JsonFieldOptions): Bm25FieldConfig {
    return {
      column,
      ...buildTokenizerConfig(opts?.tokenizer, { min: opts?.min, max: opts?.max }),
      ...(opts?.alias !== undefined && { alias: opts.alias }),
    };
  },

  /** Datetime (timestamp/date) field. */
  datetime(column: string): Bm25FieldConfig {
    return { column };
  },

  /** Range field. */
  range(column: string): Bm25FieldConfig {
    return { column };
  },

  /** Raw SQL expression field. `alias` is required. */
  expression(sql: string, opts: Bm25ExpressionFieldOptions): Bm25FieldConfig {
    return {
      expression: sql,
      alias: opts.alias,
      ...buildTokenizerConfig(opts.tokenizer, {
        min: opts.min,
        max: opts.max,
        stemmer: opts.stemmer,
        pattern: opts.pattern,
      }),
    };
  },
} as const;

/**
 * Builds `{ tokenizer, tokenizerParams? }` from a tokenizer ID and a bag of params.
 * Filters out undefined values and omits `tokenizerParams` when empty.
 */
function buildTokenizerConfig(
  tokenizer: string | undefined,
  params: Record<string, unknown>,
): TokenizerConfig {
  if (!tokenizer) return {};
  const filtered = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
  return {
    tokenizer,
    ...(Object.keys(filtered).length > 0 && { tokenizerParams: filtered }),
  };
}
