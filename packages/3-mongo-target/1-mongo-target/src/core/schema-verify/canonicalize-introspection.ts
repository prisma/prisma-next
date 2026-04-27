/**
 * Canonicalizes a live (introspected) `MongoSchemaIR` against the expected
 * (contract-built) IR before diffing. MongoDB applies server-side defaults
 * to several option/index families that are absent from authored contracts,
 * which would otherwise cause `verifyMongoSchema` to report false-positive
 * drift on a fresh `migration apply`.
 *
 * The normalization is contract-aware where it has to be: server defaults
 * are stripped from the live IR for fields the contract did not specify, so
 * a contract that *does* specify a value still gets compared faithfully.
 *
 * Symmetric defaults — like `changeStreamPreAndPostImages: { enabled: false }`,
 * which is equivalent to "absent" on both sides — are stripped from both IRs
 * so either authoring style verifies.
 */

import type {
  MongoSchemaCollection,
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  MongoSchemaIR,
} from '@prisma-next/mongo-schema-ir';
import {
  MongoSchemaCollection as MongoSchemaCollectionCtor,
  MongoSchemaCollectionOptions as MongoSchemaCollectionOptionsCtor,
  MongoSchemaIndex as MongoSchemaIndexCtor,
  MongoSchemaIR as MongoSchemaIRCtor,
} from '@prisma-next/mongo-schema-ir';

export interface CanonicalizedSchemas {
  readonly live: MongoSchemaIR;
  readonly expected: MongoSchemaIR;
}

export function canonicalizeSchemasForVerification(
  live: MongoSchemaIR,
  expected: MongoSchemaIR,
): CanonicalizedSchemas {
  const expectedByName = new Map<string, MongoSchemaCollection>();
  for (const c of expected.collections) expectedByName.set(c.name, c);

  const liveByName = new Map<string, MongoSchemaCollection>();
  for (const c of live.collections) liveByName.set(c.name, c);

  const canonicalLive = live.collections.map((c) =>
    canonicalizeLiveCollection(c, expectedByName.get(c.name)),
  );
  const canonicalExpected = expected.collections.map((c) =>
    canonicalizeExpectedCollection(c, liveByName.get(c.name)),
  );

  return {
    live: new MongoSchemaIRCtor(canonicalLive),
    expected: new MongoSchemaIRCtor(canonicalExpected),
  };
}

function canonicalizeLiveCollection(
  liveColl: MongoSchemaCollection,
  expectedColl: MongoSchemaCollection | undefined,
): MongoSchemaCollection {
  const expectedIndexes = expectedColl?.indexes ?? [];
  const indexes = liveColl.indexes.map((idx) =>
    canonicalizeLiveIndex(idx, findExpectedIndexCounterpart(idx, expectedIndexes)),
  );

  const options = liveColl.options
    ? canonicalizeLiveOptions(liveColl.options, expectedColl?.options)
    : undefined;

  return new MongoSchemaCollectionCtor({
    name: liveColl.name,
    indexes,
    ...(liveColl.validator ? { validator: liveColl.validator } : {}),
    ...(options ? { options } : {}),
  });
}

function canonicalizeExpectedCollection(
  expectedColl: MongoSchemaCollection,
  liveColl: MongoSchemaCollection | undefined,
): MongoSchemaCollection {
  // Symmetric text-index key ordering: a contract-shaped text index preserves
  // the user-authored field order, but the introspected counterpart comes
  // back from MongoDB with `weights` keys in alphabetical order, so we
  // canonicalize both sides to alphabetical text-key order. The order of
  // text fields within the text block is semantically irrelevant — relevance
  // is governed by `weights`, not key order.
  const indexes = expectedColl.indexes.map(canonicalizeTextIndexKeyOrder);

  const options = expectedColl.options
    ? canonicalizeExpectedOptions(expectedColl.options, liveColl?.options)
    : undefined;

  return new MongoSchemaCollectionCtor({
    name: expectedColl.name,
    indexes,
    ...(expectedColl.validator ? { validator: expectedColl.validator } : {}),
    ...(options ? { options } : {}),
  });
}

function canonicalizeTextIndexKeyOrder(index: MongoSchemaIndex): MongoSchemaIndex {
  const hasTextKey = index.keys.some((k) => k.direction === 'text');
  if (!hasTextKey) return index;
  return new MongoSchemaIndexCtor({
    keys: sortTextKeys(index.keys),
    ...(index.unique !== undefined ? { unique: index.unique } : {}),
    ...(index.sparse !== undefined ? { sparse: index.sparse } : {}),
    ...(index.expireAfterSeconds !== undefined
      ? { expireAfterSeconds: index.expireAfterSeconds }
      : {}),
    ...(index.partialFilterExpression
      ? { partialFilterExpression: index.partialFilterExpression }
      : {}),
    ...(index.wildcardProjection ? { wildcardProjection: index.wildcardProjection } : {}),
    ...(index.collation ? { collation: index.collation } : {}),
    ...(index.weights ? { weights: index.weights } : {}),
    ...(index.default_language !== undefined ? { default_language: index.default_language } : {}),
    ...(index.language_override !== undefined
      ? { language_override: index.language_override }
      : {}),
  });
}

/**
 * Returns a copy of `keys` with text-direction entries sorted alphabetically
 * while preserving the relative position of non-text entries. Compound text
 * indexes (`{a: 1, _fts: 'text', _ftsx: 1, b: 1}`) keep their scalar
 * prefix/suffix layout; only the contiguous text block is reordered.
 */
function sortTextKeys(
  keys: ReadonlyArray<{
    readonly field: string;
    readonly direction: 'text' | 1 | -1 | '2dsphere' | '2d' | 'hashed';
  }>,
): ReadonlyArray<{
  readonly field: string;
  readonly direction: 'text' | 1 | -1 | '2dsphere' | '2d' | 'hashed';
}> {
  const textEntries = keys.filter((k) => k.direction === 'text');
  if (textEntries.length <= 1) return keys;
  const sortedText = [...textEntries].sort((a, b) => a.field.localeCompare(b.field));
  let textIdx = 0;
  return keys.map((k) => (k.direction === 'text' ? sortedText[textIdx++]! : k));
}

function canonicalizeLiveIndex(
  liveIndex: MongoSchemaIndex,
  expectedIndex: MongoSchemaIndex | undefined,
): MongoSchemaIndex {
  const projectedKeys = sortTextKeys(projectTextIndexKeys(liveIndex));
  const collation = liveIndex.collation
    ? stripUnspecifiedFields(liveIndex.collation, expectedIndex?.collation)
    : liveIndex.collation;

  // Text-index server defaults: when the contract did not set
  // `weights`/`default_language`/`language_override`, MongoDB applies
  // `weights = {<field>: 1, ...}` (uniform), `'english'`, and `'language'`
  // respectively. Strip them from live so the lookup key matches a contract
  // that authored none of those.
  const weights = expectedIndex?.weights === undefined ? undefined : liveIndex.weights;
  const default_language =
    expectedIndex?.default_language === undefined ? undefined : liveIndex.default_language;
  const language_override =
    expectedIndex?.language_override === undefined ? undefined : liveIndex.language_override;

  return new MongoSchemaIndexCtor({
    keys: projectedKeys,
    ...(liveIndex.unique !== undefined ? { unique: liveIndex.unique } : {}),
    ...(liveIndex.sparse !== undefined ? { sparse: liveIndex.sparse } : {}),
    ...(liveIndex.expireAfterSeconds !== undefined
      ? { expireAfterSeconds: liveIndex.expireAfterSeconds }
      : {}),
    ...(liveIndex.partialFilterExpression
      ? { partialFilterExpression: liveIndex.partialFilterExpression }
      : {}),
    ...(liveIndex.wildcardProjection ? { wildcardProjection: liveIndex.wildcardProjection } : {}),
    ...(collation ? { collation } : {}),
    ...(weights ? { weights } : {}),
    ...(default_language !== undefined ? { default_language } : {}),
    ...(language_override !== undefined ? { language_override } : {}),
  });
}

/**
 * Locate the contract-side index that corresponds to a live index for the
 * purpose of contract-aware normalization. We deliberately match by the
 * *projected* (contract-shaped) key list — so a live `_fts/_ftsx` index
 * resolves to a contract `{title: 'text', body: 'text'}` index — and pick
 * the first match. Contracts very rarely contain duplicate-key indexes; if
 * we have no counterpart we fall back to no normalization for that index.
 */
function findExpectedIndexCounterpart(
  liveIndex: MongoSchemaIndex,
  expectedIndexes: ReadonlyArray<MongoSchemaIndex>,
): MongoSchemaIndex | undefined {
  const projectedLiveKeys = sortTextKeys(projectTextIndexKeys(liveIndex));
  const liveKeySig = projectedLiveKeys.map((k) => `${k.field}:${k.direction}`).join(',');
  for (const expected of expectedIndexes) {
    const expectedKeySig = sortTextKeys(expected.keys)
      .map((k) => `${k.field}:${k.direction}`)
      .join(',');
    if (expectedKeySig === liveKeySig) return expected;
  }
  return undefined;
}

/**
 * MongoDB expands a contract-shaped text index like
 * `[{title: 'text'}, {body: 'text'}]` into its internal weighted vector
 * representation `[{_fts: 'text'}, {_ftsx: 1}]`, recording the original
 * field names + per-field weights in the `weights` document. We project
 * back to the contract-shaped key list using `weights`, relying on
 * MongoDB preserving its insertion order for that document.
 */
function projectTextIndexKeys(liveIndex: MongoSchemaIndex): ReadonlyArray<{
  readonly field: string;
  readonly direction: 'text' | 1 | -1 | '2dsphere' | '2d' | 'hashed';
}> {
  const isTextIndex =
    liveIndex.keys.length >= 1 &&
    liveIndex.keys.some((k) => k.field === '_fts' && k.direction === 'text');

  if (!isTextIndex || !liveIndex.weights) return liveIndex.keys;

  const textKeys = Object.keys(liveIndex.weights).map((field) => ({
    field,
    direction: 'text' as const,
  }));

  // Carry through any non-`_fts/_ftsx` keys that come before/after the
  // weighted block (compound text indexes can mix scalar prefixes/suffixes
  // with text fields). The internal `_fts` / `_ftsx` pair is replaced.
  const scalarKeys = liveIndex.keys.filter((k) => k.field !== '_fts' && k.field !== '_ftsx');
  return [...scalarKeys, ...textKeys];
}

function canonicalizeLiveOptions(
  liveOptions: MongoSchemaCollectionOptions,
  expectedOptions: MongoSchemaCollectionOptions | undefined,
): MongoSchemaCollectionOptions | undefined {
  const collation = liveOptions.collation
    ? stripUnspecifiedFields(liveOptions.collation, expectedOptions?.collation)
    : undefined;

  // Timeseries: drop `bucketMaxSpanSeconds` (and any other server-applied
  // extras) when the contract did not specify them.
  const timeseries = liveOptions.timeseries
    ? (stripUnspecifiedFieldsLoose(
        liveOptions.timeseries as Record<string, unknown>,
        expectedOptions?.timeseries as Record<string, unknown> | undefined,
      ) as MongoSchemaCollectionOptions['timeseries'])
    : undefined;

  // ClusteredIndex: drop `key`, `unique`, `v` and any other server-applied
  // extras when the contract did not specify them.
  const clusteredIndex = liveOptions.clusteredIndex
    ? (stripUnspecifiedFieldsLoose(
        liveOptions.clusteredIndex as Record<string, unknown>,
        expectedOptions?.clusteredIndex as Record<string, unknown> | undefined,
      ) as MongoSchemaCollectionOptions['clusteredIndex'])
    : undefined;

  // changeStreamPreAndPostImages: `{enabled: false}` is equivalent to
  // "absent". Strip it from live so it round-trips with a contract that
  // omits the field, and is symmetric with the expected-side stripping.
  const changeStreamPreAndPostImages = isDisabledChangeStream(
    liveOptions.changeStreamPreAndPostImages,
  )
    ? undefined
    : liveOptions.changeStreamPreAndPostImages;

  const hasMeaningful =
    liveOptions.capped || timeseries || collation || changeStreamPreAndPostImages || clusteredIndex;
  if (!hasMeaningful) return undefined;

  return new MongoSchemaCollectionOptionsCtor({
    ...(liveOptions.capped ? { capped: liveOptions.capped } : {}),
    ...(timeseries ? { timeseries } : {}),
    ...(collation ? { collation } : {}),
    ...(changeStreamPreAndPostImages ? { changeStreamPreAndPostImages } : {}),
    ...(clusteredIndex ? { clusteredIndex } : {}),
  });
}

function canonicalizeExpectedOptions(
  expectedOptions: MongoSchemaCollectionOptions,
  _liveOptions: MongoSchemaCollectionOptions | undefined,
): MongoSchemaCollectionOptions | undefined {
  // Symmetric: a contract `{enabled: false}` is equivalent to absent.
  const changeStreamPreAndPostImages = isDisabledChangeStream(
    expectedOptions.changeStreamPreAndPostImages,
  )
    ? undefined
    : expectedOptions.changeStreamPreAndPostImages;

  const hasMeaningful =
    expectedOptions.capped ||
    expectedOptions.timeseries ||
    expectedOptions.collation ||
    changeStreamPreAndPostImages ||
    expectedOptions.clusteredIndex;
  if (!hasMeaningful) return undefined;

  return new MongoSchemaCollectionOptionsCtor({
    ...(expectedOptions.capped ? { capped: expectedOptions.capped } : {}),
    ...(expectedOptions.timeseries ? { timeseries: expectedOptions.timeseries } : {}),
    ...(expectedOptions.collation ? { collation: expectedOptions.collation } : {}),
    ...(changeStreamPreAndPostImages ? { changeStreamPreAndPostImages } : {}),
    ...(expectedOptions.clusteredIndex ? { clusteredIndex: expectedOptions.clusteredIndex } : {}),
  });
}

function isDisabledChangeStream(value: { enabled: boolean } | undefined): boolean {
  return value !== undefined && value.enabled === false;
}

/**
 * Returns a copy of `live` containing only the keys that `expected` defines.
 * Used for fields whose comparison should be limited to what the contract
 * actually authored (server-applied defaults are stripped). Returns
 * `undefined` if `expected` is `undefined` (contract said nothing → strip
 * the entire live block).
 */
function stripUnspecifiedFields(
  live: Record<string, unknown>,
  expected: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (expected === undefined) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(expected)) {
    if (key in live) out[key] = live[key];
  }
  return out;
}

/**
 * Same as `stripUnspecifiedFields` but, when the contract specifies the
 * block at all, preserves any keys the *contract* specified (so a
 * mismatch on a contract-set field is still detected). For loose-typed
 * sub-objects like `timeseries` and `clusteredIndex` whose IR shape is
 * narrower than what introspection actually returns.
 */
function stripUnspecifiedFieldsLoose(
  live: Record<string, unknown>,
  expected: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (expected === undefined) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(expected)) {
    if (key in live) out[key] = live[key];
  }
  return out;
}
