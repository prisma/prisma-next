import type { Bm25FieldConfig } from '@prisma-next/sql-contract';
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
 * Options for a BM25 ngram field.
 */
export type Bm25NgramFieldOptions = {
  readonly min: number;
  readonly max: number;
  readonly prefix_only?: boolean;
  readonly positions?: boolean;
  readonly alias?: string;
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

/**
 * Typed BM25 field builders.
 * These produce `Bm25FieldConfig` objects for use in `bm25Index()`.
 */
export const bm25 = {
  /** Text field with optional tokenizer config. */
  text(column: string, opts?: Bm25TextFieldOptions): Bm25FieldConfig {
    return {
      column,
      ...tokenizerFromTextOpts(opts),
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
      ...tokenizerFromJsonOpts(opts),
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
      ...tokenizerFromExprOpts(opts),
    };
  },
} as const;

function tokenizerFromTextOpts(
  opts?: Bm25TextFieldOptions,
): Pick<Bm25FieldConfig, 'tokenizer' | 'tokenizerParams'> {
  if (!opts?.tokenizer) return {};
  const params: Record<string, unknown> = {};
  if (opts.stemmer !== undefined) params.stemmer = opts.stemmer;
  if (opts.remove_emojis !== undefined) params.remove_emojis = opts.remove_emojis;
  return {
    tokenizer: opts.tokenizer,
    ...(Object.keys(params).length > 0 && { tokenizerParams: params }),
  };
}

function tokenizerFromJsonOpts(
  opts?: Bm25JsonFieldOptions,
): Pick<Bm25FieldConfig, 'tokenizer' | 'tokenizerParams'> {
  if (!opts?.tokenizer) return {};
  const params: Record<string, unknown> = {};
  if (opts.min !== undefined) params.min = opts.min;
  if (opts.max !== undefined) params.max = opts.max;
  return {
    tokenizer: opts.tokenizer,
    ...(Object.keys(params).length > 0 && { tokenizerParams: params }),
  };
}

function tokenizerFromExprOpts(
  opts: Bm25ExpressionFieldOptions,
): Pick<Bm25FieldConfig, 'tokenizer' | 'tokenizerParams'> {
  if (!opts.tokenizer) return {};
  const params: Record<string, unknown> = {};
  if (opts.min !== undefined) params.min = opts.min;
  if (opts.max !== undefined) params.max = opts.max;
  if (opts.stemmer !== undefined) params.stemmer = opts.stemmer;
  if (opts.pattern !== undefined) params.pattern = opts.pattern;
  return {
    tokenizer: opts.tokenizer,
    ...(Object.keys(params).length > 0 && { tokenizerParams: params }),
  };
}
