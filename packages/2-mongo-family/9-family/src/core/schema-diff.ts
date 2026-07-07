import type { ControlPolicy } from '@prisma-next/contract/types';
import type { SchemaIssue, VerifierOutcome } from '@prisma-next/framework-components/control';
import type {
  MongoSchemaCollection,
  MongoSchemaIndex,
  MongoSchemaIR,
} from '@prisma-next/mongo-schema-ir';
import { canonicalize, deepEqual } from '@prisma-next/mongo-schema-ir';
import { verifierDisposition } from './schema-verify/verifier-disposition';

/**
 * The Mongo schema diff, issue-only: `failures` carry the verdict (a verify
 * passes exactly when it is empty), `warnings` the surviving warn-graded
 * findings (live-only extras in non-strict mode, `observed` subjects).
 */
export interface MongoSchemaDiff {
  readonly failures: readonly SchemaIssue[];
  readonly warnings: readonly SchemaIssue[];
}

/**
 * Reconciles a control-policy disposition with the Mongo family's strict-mode
 * contract for live-only extras — the single point where `strict` and the
 * control policy meet.
 *
 * The control policy decides first; only a `fail` is reconciled against the
 * caller's base outcome. Call sites grade a live-only extra with
 * `strict ? 'fail' : 'warn'` and a declared missing/mismatch with `fail`, so
 * this one step encodes the whole matrix:
 *
 * | live-vs-declared                    | strict   | non-strict |
 * |-------------------------------------|----------|------------|
 * | declared missing / mismatch         | fail     | fail       |
 * | live-only extra (managed/tolerated) | fail     | warn       |
 * | live-only extra (external)          | suppress (extras ignored, both modes) |
 * | anything (observed)                 | warn (both modes)     |
 *
 * `tolerated` does not diverge from `managed` on a non-strict extra index:
 * both soften to `warn`, because the softening comes from the base outcome the
 * caller already computed from `strict`, not from per-policy special-casing.
 */
function emitMongoIssueUnderControlPolicy(
  controlPolicy: ControlPolicy,
  issue: SchemaIssue,
  baseOutcome: 'fail' | 'warn',
  failures: SchemaIssue[],
  warnings: SchemaIssue[],
): VerifierOutcome {
  const disposition = verifierDisposition(controlPolicy, issue.kind);
  const outcome = disposition === 'fail' ? baseOutcome : disposition;
  if (outcome === 'suppress') {
    return 'suppress';
  }
  if (outcome === 'warn') {
    warnings.push(issue);
  } else {
    failures.push(issue);
  }
  return outcome;
}

export function diffMongoSchemas(
  live: MongoSchemaIR,
  expected: MongoSchemaIR,
  strict: boolean,
  collectionControlPolicy: (collectionName: string) => ControlPolicy,
): MongoSchemaDiff {
  const failures: SchemaIssue[] = [];
  const warnings: SchemaIssue[] = [];

  const allNames = new Set([...live.collectionNames, ...expected.collectionNames]);

  for (const name of [...allNames].sort()) {
    const liveColl = live.collection(name);
    const expectedColl = expected.collection(name);

    if (!liveColl && expectedColl) {
      emitMongoIssueUnderControlPolicy(
        collectionControlPolicy(name),
        {
          kind: 'missing_table',
          reason: 'not-found',
          table: name,
          message: `Collection "${name}" is missing from the database`,
        },
        'fail',
        failures,
        warnings,
      );
      continue;
    }

    if (liveColl && !expectedColl) {
      emitMongoIssueUnderControlPolicy(
        collectionControlPolicy(name),
        {
          kind: 'extra_table',
          reason: 'not-expected',
          table: name,
          message: `Extra collection "${name}" exists in the database but not in the contract`,
        },
        strict ? 'fail' : 'warn',
        failures,
        warnings,
      );
      continue;
    }

    const lc = liveColl as MongoSchemaCollection;
    const ec = expectedColl as MongoSchemaCollection;
    const controlPolicy = collectionControlPolicy(name);
    diffIndexes(name, lc, ec, strict, controlPolicy, failures, warnings);
    diffValidator(name, lc, ec, strict, controlPolicy, failures, warnings);
    diffOptions(name, lc, ec, strict, controlPolicy, failures, warnings);
  }

  return { failures, warnings };
}

function buildIndexLookupKey(index: MongoSchemaIndex): string {
  const keys = index.keys.map((k) => `${k.field}:${k.direction}`).join(',');
  const opts = [
    index.unique ? 'unique' : '',
    index.sparse ? 'sparse' : '',
    index.expireAfterSeconds != null ? `ttl:${index.expireAfterSeconds}` : '',
    index.partialFilterExpression ? `pfe:${canonicalize(index.partialFilterExpression)}` : '',
    index.wildcardProjection ? `wp:${canonicalize(index.wildcardProjection)}` : '',
    index.collation ? `col:${canonicalize(index.collation)}` : '',
    index.weights ? `wt:${canonicalize(index.weights)}` : '',
    index.default_language ? `dl:${index.default_language}` : '',
    index.language_override ? `lo:${index.language_override}` : '',
  ]
    .filter(Boolean)
    .join(';');
  return opts ? `${keys}|${opts}` : keys;
}

function formatIndexName(index: MongoSchemaIndex): string {
  return index.keys.map((k) => `${k.field}:${k.direction}`).join(', ');
}

function diffIndexes(
  collName: string,
  live: MongoSchemaCollection,
  expected: MongoSchemaCollection,
  strict: boolean,
  collectionControlPolicy: ControlPolicy,
  failures: SchemaIssue[],
  warnings: SchemaIssue[],
): void {
  const liveLookup = new Map<string, MongoSchemaIndex>();
  for (const idx of live.indexes) liveLookup.set(buildIndexLookupKey(idx), idx);

  const expectedLookup = new Map<string, MongoSchemaIndex>();
  for (const idx of expected.indexes) expectedLookup.set(buildIndexLookupKey(idx), idx);

  for (const [key, idx] of expectedLookup) {
    if (!liveLookup.has(key)) {
      emitMongoIssueUnderControlPolicy(
        collectionControlPolicy,
        {
          kind: 'index_mismatch',
          reason: 'not-equal',
          table: collName,
          indexOrConstraint: formatIndexName(idx),
          message: `Index ${formatIndexName(idx)} missing on collection "${collName}"`,
        },
        'fail',
        failures,
        warnings,
      );
    }
  }

  for (const [key, idx] of liveLookup) {
    if (!expectedLookup.has(key)) {
      emitMongoIssueUnderControlPolicy(
        collectionControlPolicy,
        {
          kind: 'extra_index',
          reason: 'not-expected',
          table: collName,
          indexOrConstraint: formatIndexName(idx),
          message: `Extra index ${formatIndexName(idx)} on collection "${collName}"`,
        },
        strict ? 'fail' : 'warn',
        failures,
        warnings,
      );
    }
  }
}

function diffValidator(
  collName: string,
  live: MongoSchemaCollection,
  expected: MongoSchemaCollection,
  strict: boolean,
  collectionControlPolicy: ControlPolicy,
  failures: SchemaIssue[],
  warnings: SchemaIssue[],
): void {
  if (!live.validator && !expected.validator) return;

  if (expected.validator && !live.validator) {
    emitMongoIssueUnderControlPolicy(
      collectionControlPolicy,
      {
        kind: 'type_missing',
        reason: 'not-found',
        table: collName,
        message: `Validator missing on collection "${collName}"`,
      },
      'fail',
      failures,
      warnings,
    );
    return;
  }

  if (!expected.validator && live.validator) {
    emitMongoIssueUnderControlPolicy(
      collectionControlPolicy,
      {
        kind: 'extra_validator',
        reason: 'not-expected',
        table: collName,
        message: `Extra validator on collection "${collName}"`,
      },
      strict ? 'fail' : 'warn',
      failures,
      warnings,
    );
    return;
  }

  const liveVal = live.validator as NonNullable<typeof live.validator>;
  const expectedVal = expected.validator as NonNullable<typeof expected.validator>;
  const liveSchema = canonicalize(liveVal.jsonSchema);
  const expectedSchema = canonicalize(expectedVal.jsonSchema);

  if (
    liveSchema !== expectedSchema ||
    liveVal.validationLevel !== expectedVal.validationLevel ||
    liveVal.validationAction !== expectedVal.validationAction
  ) {
    emitMongoIssueUnderControlPolicy(
      collectionControlPolicy,
      {
        kind: 'type_mismatch',
        reason: 'not-equal',
        table: collName,
        expected: expectedSchema,
        actual: liveSchema,
        message: `Validator mismatch on collection "${collName}"`,
      },
      'fail',
      failures,
      warnings,
    );
  }
}

function diffOptions(
  collName: string,
  live: MongoSchemaCollection,
  expected: MongoSchemaCollection,
  strict: boolean,
  collectionControlPolicy: ControlPolicy,
  failures: SchemaIssue[],
  warnings: SchemaIssue[],
): void {
  if (!live.options && !expected.options) return;

  if (!expected.options && live.options) {
    emitMongoIssueUnderControlPolicy(
      collectionControlPolicy,
      {
        kind: 'type_mismatch',
        reason: 'not-equal',
        table: collName,
        actual: canonicalize(live.options),
        message: `Extra collection options on "${collName}"`,
      },
      strict ? 'fail' : 'warn',
      failures,
      warnings,
    );
    return;
  }

  if (deepEqual(live.options, expected.options)) {
    return;
  }

  emitMongoIssueUnderControlPolicy(
    collectionControlPolicy,
    {
      kind: 'type_mismatch',
      reason: 'not-equal',
      table: collName,
      expected: canonicalize(expected.options),
      actual: canonicalize(live.options),
      message: `Collection options mismatch on "${collName}"`,
    },
    'fail',
    failures,
    warnings,
  );
}
