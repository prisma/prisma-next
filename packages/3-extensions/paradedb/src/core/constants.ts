/**
 * Extension ID for ParadeDB pg_search.
 */
export const PARADEDB_EXTENSION_ID = 'paradedb' as const;

/**
 * Built-in ParadeDB tokenizer IDs.
 * These correspond to the `pdb.*` casting syntax in `CREATE INDEX ... USING bm25`.
 */
export type TokenizerId =
  | 'unicode_words'
  | 'simple'
  | 'ngram'
  | 'icu'
  | 'regex_pattern'
  | 'source_code'
  | 'literal'
  | 'literal_normalized'
  | 'whitespace'
  | 'chinese_compatible'
  | 'jieba'
  | 'lindera';
