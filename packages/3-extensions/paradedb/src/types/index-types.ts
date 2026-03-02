import type { IndexDef } from '@prisma-next/contract-authoring';
import type { TokenizerId } from '../core/constants';

/**
 * BM25 field config for a table column.
 */
export type Bm25ColumnFieldConfig = {
  readonly column: string;
  readonly expression?: never;
  readonly tokenizer?: string;
  readonly tokenizerParams?: Record<string, unknown>;
  readonly alias?: string;
};

/**
 * BM25 field config for a SQL expression.
 */
export type Bm25ExpressionFieldConfig = {
  readonly expression: string;
  readonly column?: never;
  readonly alias: string;
  readonly tokenizer?: string;
  readonly tokenizerParams?: Record<string, unknown>;
};

/**
 * BM25 field config union.
 */
export type Bm25FieldConfig = Bm25ColumnFieldConfig | Bm25ExpressionFieldConfig;

/**
 * BM25 index configuration payload stored in `IndexDef.config`.
 */
export type Bm25IndexConfig = {
  readonly keyField: string;
  readonly fields: readonly Bm25FieldConfig[];
};

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
 * Options for constructing a BM25 index definition.
 */
export type Bm25IndexOptions = {
  readonly keyField: string;
  readonly fields: readonly Bm25FieldConfig[];
  readonly name?: string;
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
 * Creates a generic index definition with a ParadeDB BM25 payload.
 *
 * `columns` only includes real table columns so core index validation remains
 * target-agnostic. Expression fields stay in extension-owned `config.fields`.
 */
export function bm25Index(opts: Bm25IndexOptions): IndexDef {
  return {
    columns: opts.fields.flatMap((field) => ('column' in field ? [field.column] : [])),
    ...(opts.name !== undefined && { name: opts.name }),
    using: 'bm25',
    config: {
      keyField: opts.keyField,
      fields: opts.fields,
    } satisfies Bm25IndexConfig,
  };
}

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
