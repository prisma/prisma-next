import type { ControlPolicy } from '@prisma-next/contract/types';
import type {
  SchemaIssue,
  SchemaVerificationNode,
} from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type {
  MongoSchemaCollection,
  MongoSchemaIndex,
  MongoSchemaIR,
} from '@prisma-next/mongo-schema-ir';
import { canonicalize, deepEqual } from '@prisma-next/mongo-schema-ir';
import { pushMongoControlledFinding } from './schema-verify/mongo-control-verify-emit';

export function diffMongoSchemas(
  live: MongoSchemaIR,
  expected: MongoSchemaIR,
  strict: boolean,
  collectionControl: (collectionName: string) => ControlPolicy,
): {
  root: SchemaVerificationNode;
  issues: SchemaIssue[];
  counts: { pass: number; warn: number; fail: number; totalNodes: number };
} {
  const issues: SchemaIssue[] = [];
  const collectionChildren: SchemaVerificationNode[] = [];
  let pass = 0;
  let warn = 0;
  let fail = 0;

  const allNames = new Set([...live.collectionNames, ...expected.collectionNames]);

  for (const name of [...allNames].sort()) {
    const liveColl = live.collection(name);
    const expectedColl = expected.collection(name);

    if (!liveColl && expectedColl) {
      const control = collectionControl(name);
      const issue: SchemaIssue = {
        kind: 'missing_table',
        table: name,
        message: `Collection "${name}" is missing from the database`,
      };
      const disposition = pushMongoControlledFinding(
        control,
        issue,
        {
          status: 'fail',
          kind: 'collection',
          name,
          contractPath: `storage.namespaces.${UNBOUND_NAMESPACE_ID}.collections.${name}`,
          code: 'MISSING_COLLECTION',
          message: `Collection "${name}" is missing`,
          expected: name,
          actual: null,
          children: [],
        },
        issues,
        collectionChildren,
        strict,
      );
      if (disposition === 'fail') fail++;
      else if (disposition === 'warn') warn++;
      continue;
    }

    if (liveColl && !expectedColl) {
      const control = collectionControl(name);
      const issue: SchemaIssue = {
        kind: 'extra_table',
        table: name,
        message: `Extra collection "${name}" exists in the database but not in the contract`,
      };
      const baseStatus = strict ? 'fail' : 'warn';
      const disposition = pushMongoControlledFinding(
        control,
        issue,
        {
          status: baseStatus,
          kind: 'collection',
          name,
          contractPath: `storage.namespaces.${UNBOUND_NAMESPACE_ID}.collections.${name}`,
          code: 'EXTRA_COLLECTION',
          message: `Extra collection "${name}" found`,
          expected: null,
          actual: name,
          children: [],
        },
        issues,
        collectionChildren,
        strict,
      );
      if (disposition === 'fail') fail++;
      else if (disposition === 'warn') warn++;
      continue;
    }

    const lc = liveColl as MongoSchemaCollection;
    const ec = expectedColl as MongoSchemaCollection;
    const control = collectionControl(name);
    const indexChildren = diffIndexes(name, lc, ec, strict, control, issues);
    const validatorChildren = diffValidator(name, lc, ec, strict, control, issues);
    const optionsChildren = diffOptions(name, lc, ec, strict, control, issues);
    const children = [...indexChildren, ...validatorChildren, ...optionsChildren];

    const worstStatus = children.reduce<'pass' | 'warn' | 'fail'>(
      (s, c) => (c.status === 'fail' ? 'fail' : c.status === 'warn' && s !== 'fail' ? 'warn' : s),
      'pass',
    );

    for (const c of children) {
      if (c.status === 'pass') pass++;
      else if (c.status === 'warn') warn++;
      else fail++;
    }

    if (children.length === 0) {
      pass++;
    }

    collectionChildren.push({
      status: worstStatus,
      kind: 'collection',
      name,
      contractPath: `storage.namespaces.${UNBOUND_NAMESPACE_ID}.collections.${name}`,
      code: worstStatus === 'pass' ? 'MATCH' : 'DRIFT',
      message:
        worstStatus === 'pass' ? `Collection "${name}" matches` : `Collection "${name}" has drift`,
      expected: name,
      actual: name,
      children,
    });
  }

  const rootStatus = fail > 0 ? 'fail' : warn > 0 ? 'warn' : 'pass';
  const totalNodes = pass + warn + fail + collectionChildren.length;

  const root: SchemaVerificationNode = {
    status: rootStatus,
    kind: 'root',
    name: 'mongo-schema',
    contractPath: 'storage',
    code: rootStatus === 'pass' ? 'MATCH' : 'DRIFT',
    message: rootStatus === 'pass' ? 'Schema matches' : 'Schema has drift',
    expected: null,
    actual: null,
    children: collectionChildren,
  };

  return { root, issues, counts: { pass, warn, fail, totalNodes } };
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
  collectionControl: ControlPolicy,
  issues: SchemaIssue[],
): SchemaVerificationNode[] {
  const nodes: SchemaVerificationNode[] = [];
  const liveLookup = new Map<string, MongoSchemaIndex>();
  for (const idx of live.indexes) liveLookup.set(buildIndexLookupKey(idx), idx);

  const expectedLookup = new Map<string, MongoSchemaIndex>();
  for (const idx of expected.indexes) expectedLookup.set(buildIndexLookupKey(idx), idx);

  for (const [key, idx] of expectedLookup) {
    if (liveLookup.has(key)) {
      nodes.push({
        status: 'pass',
        kind: 'index',
        name: formatIndexName(idx),
        contractPath: `storage.namespaces.${UNBOUND_NAMESPACE_ID}.collections.${collName}.indexes`,
        code: 'MATCH',
        message: `Index ${formatIndexName(idx)} matches`,
        expected: key,
        actual: key,
        children: [],
      });
    } else {
      const issue: SchemaIssue = {
        kind: 'index_mismatch',
        table: collName,
        indexOrConstraint: formatIndexName(idx),
        message: `Index ${formatIndexName(idx)} missing on collection "${collName}"`,
      };
      pushMongoControlledFinding(
        collectionControl,
        issue,
        {
          status: 'fail',
          kind: 'index',
          name: formatIndexName(idx),
          contractPath: `storage.namespaces.${UNBOUND_NAMESPACE_ID}.collections.${collName}.indexes`,
          code: 'MISSING_INDEX',
          message: `Index ${formatIndexName(idx)} missing`,
          expected: key,
          actual: null,
          children: [],
        },
        issues,
        nodes,
        strict,
      );
    }
  }

  for (const [key, idx] of liveLookup) {
    if (!expectedLookup.has(key)) {
      const issue: SchemaIssue = {
        kind: 'extra_index',
        table: collName,
        indexOrConstraint: formatIndexName(idx),
        message: `Extra index ${formatIndexName(idx)} on collection "${collName}"`,
      };
      const baseStatus = strict ? 'fail' : 'warn';
      pushMongoControlledFinding(
        collectionControl,
        issue,
        {
          status: baseStatus,
          kind: 'index',
          name: formatIndexName(idx),
          contractPath: `storage.namespaces.${UNBOUND_NAMESPACE_ID}.collections.${collName}.indexes`,
          code: 'EXTRA_INDEX',
          message: `Extra index ${formatIndexName(idx)}`,
          expected: null,
          actual: key,
          children: [],
        },
        issues,
        nodes,
        strict,
      );
    }
  }

  return nodes;
}

function diffValidator(
  collName: string,
  live: MongoSchemaCollection,
  expected: MongoSchemaCollection,
  strict: boolean,
  collectionControl: ControlPolicy,
  issues: SchemaIssue[],
): SchemaVerificationNode[] {
  if (!live.validator && !expected.validator) return [];

  if (expected.validator && !live.validator) {
    const issue: SchemaIssue = {
      kind: 'type_missing',
      table: collName,
      message: `Validator missing on collection "${collName}"`,
    };
    const nodes: SchemaVerificationNode[] = [];
    pushMongoControlledFinding(
      collectionControl,
      issue,
      {
        status: 'fail',
        kind: 'validator',
        name: 'validator',
        contractPath: `storage.namespaces.${UNBOUND_NAMESPACE_ID}.collections.${collName}.validator`,
        code: 'MISSING_VALIDATOR',
        message: 'Validator missing',
        expected: canonicalize(expected.validator.jsonSchema),
        actual: null,
        children: [],
      },
      issues,
      nodes,
      strict,
    );
    return nodes;
  }

  if (!expected.validator && live.validator) {
    const issue: SchemaIssue = {
      kind: 'extra_validator',
      table: collName,
      message: `Extra validator on collection "${collName}"`,
    };
    const nodes: SchemaVerificationNode[] = [];
    const baseStatus = strict ? 'fail' : 'warn';
    pushMongoControlledFinding(
      collectionControl,
      issue,
      {
        status: baseStatus,
        kind: 'validator',
        name: 'validator',
        contractPath: `storage.namespaces.${UNBOUND_NAMESPACE_ID}.collections.${collName}.validator`,
        code: 'EXTRA_VALIDATOR',
        message: 'Extra validator found',
        expected: null,
        actual: canonicalize(live.validator.jsonSchema),
        children: [],
      },
      issues,
      nodes,
      strict,
    );
    return nodes;
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
    const issue: SchemaIssue = {
      kind: 'type_mismatch',
      table: collName,
      expected: expectedSchema,
      actual: liveSchema,
      message: `Validator mismatch on collection "${collName}"`,
    };
    const nodes: SchemaVerificationNode[] = [];
    pushMongoControlledFinding(
      collectionControl,
      issue,
      {
        status: 'fail',
        kind: 'validator',
        name: 'validator',
        contractPath: `storage.namespaces.${UNBOUND_NAMESPACE_ID}.collections.${collName}.validator`,
        code: 'VALIDATOR_MISMATCH',
        message: 'Validator mismatch',
        expected: {
          jsonSchema: expectedVal.jsonSchema,
          validationLevel: expectedVal.validationLevel,
          validationAction: expectedVal.validationAction,
        },
        actual: {
          jsonSchema: liveVal.jsonSchema,
          validationLevel: liveVal.validationLevel,
          validationAction: liveVal.validationAction,
        },
        children: [],
      },
      issues,
      nodes,
      strict,
    );
    return nodes;
  }

  return [
    {
      status: 'pass',
      kind: 'validator',
      name: 'validator',
      contractPath: `storage.namespaces.${UNBOUND_NAMESPACE_ID}.collections.${collName}.validator`,
      code: 'MATCH',
      message: 'Validator matches',
      expected: expectedSchema,
      actual: liveSchema,
      children: [],
    },
  ];
}

function diffOptions(
  collName: string,
  live: MongoSchemaCollection,
  expected: MongoSchemaCollection,
  strict: boolean,
  collectionControl: ControlPolicy,
  issues: SchemaIssue[],
): SchemaVerificationNode[] {
  if (!live.options && !expected.options) return [];

  if (!expected.options && live.options) {
    const issue: SchemaIssue = {
      kind: 'type_mismatch',
      table: collName,
      actual: canonicalize(live.options),
      message: `Extra collection options on "${collName}"`,
    };
    const nodes: SchemaVerificationNode[] = [];
    const baseStatus = strict ? 'fail' : 'warn';
    pushMongoControlledFinding(
      collectionControl,
      issue,
      {
        status: baseStatus,
        kind: 'options',
        name: 'options',
        contractPath: `storage.namespaces.${UNBOUND_NAMESPACE_ID}.collections.${collName}.options`,
        code: 'EXTRA_OPTIONS',
        message: 'Extra collection options found',
        expected: null,
        actual: live.options,
        children: [],
      },
      issues,
      nodes,
      strict,
      { legacyNonStrictWarn: true },
    );
    return nodes;
  }

  if (deepEqual(live.options, expected.options)) {
    return [
      {
        status: 'pass',
        kind: 'options',
        name: 'options',
        contractPath: `storage.namespaces.${UNBOUND_NAMESPACE_ID}.collections.${collName}.options`,
        code: 'MATCH',
        message: 'Collection options match',
        expected: canonicalize(expected.options),
        actual: canonicalize(live.options),
        children: [],
      },
    ];
  }

  const issue: SchemaIssue = {
    kind: 'type_mismatch',
    table: collName,
    expected: canonicalize(expected.options),
    actual: canonicalize(live.options),
    message: `Collection options mismatch on "${collName}"`,
  };
  const nodes: SchemaVerificationNode[] = [];
  pushMongoControlledFinding(
    collectionControl,
    issue,
    {
      status: 'fail',
      kind: 'options',
      name: 'options',
      contractPath: `storage.namespaces.${UNBOUND_NAMESPACE_ID}.collections.${collName}.options`,
      code: 'OPTIONS_MISMATCH',
      message: 'Collection options mismatch',
      expected: expected.options,
      actual: live.options,
      children: [],
    },
    issues,
    nodes,
    strict,
  );
  return nodes;
}
