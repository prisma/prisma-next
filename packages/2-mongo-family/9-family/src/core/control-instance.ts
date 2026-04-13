import {
  contractToMongoSchemaIR,
  introspectSchema,
  readMarker,
} from '@prisma-next/adapter-mongo/control';
import type { Contract, ContractMarkerRecord } from '@prisma-next/contract/types';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  ControlStack,
  CoreSchemaView,
  SchemaIssue,
  SchemaTreeNode,
  SchemaVerificationNode,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import type { MongoContract } from '@prisma-next/mongo-contract';
import { validateMongoContract } from '@prisma-next/mongo-contract';
import type {
  MongoSchemaCollection,
  MongoSchemaIndex,
  MongoSchemaIR,
} from '@prisma-next/mongo-schema-ir';
import { canonicalize, deepEqual } from '@prisma-next/mongo-schema-ir';
import type { Db } from 'mongodb';

const MIGRATIONS_COLLECTION = '_prisma_migrations';
const MARKER_ID = 'marker';

export interface MongoControlFamilyInstance extends ControlFamilyInstance<'mongo', MongoSchemaIR> {
  validateContract(contractJson: unknown): Contract;
}

function extractDb(driver: ControlDriverInstance<'mongo', string>): Db {
  const mongoDriver = driver as ControlDriverInstance<'mongo', string> & { db?: Db };
  if (!mongoDriver.db) {
    throw new Error(
      'Mongo control driver does not expose a db property. ' +
        'Use createMongoControlDriver() from @prisma-next/adapter-mongo/control.',
    );
  }
  return mongoDriver.db;
}

class MongoFamilyInstance implements MongoControlFamilyInstance {
  readonly familyId = 'mongo' as const;

  validateContract(contractJson: unknown): Contract {
    const validated = validateMongoContract<MongoContract>(contractJson);
    // MongoContract and Contract share structure but are typed independently;
    // validateMongoContract guarantees the shape, so the double cast is safe.
    return validated.contract as unknown as Contract;
  }

  async verify(options: {
    readonly driver: ControlDriverInstance<'mongo', string>;
    readonly contract: unknown;
    readonly expectedTargetId: string;
    readonly contractPath: string;
    readonly configPath?: string;
  }): Promise<VerifyDatabaseResult> {
    const { driver, contract: rawContract, expectedTargetId, contractPath, configPath } = options;
    const startTime = Date.now();

    const validated = validateMongoContract<MongoContract>(rawContract);
    const contract = validated.contract;

    const contractStorageHash = contract.storage.storageHash;
    const contractProfileHash = contract.profileHash;
    const contractTarget = contract.target;

    const db = extractDb(driver);
    const marker = await readMarker(db);

    const baseOpts = {
      contractStorageHash,
      contractProfileHash,
      expectedTargetId,
      contractPath,
      ...(configPath ? { configPath } : {}),
    };

    if (!marker) {
      return buildVerifyResult({
        ...baseOpts,
        ok: false,
        code: 'PN-RUN-3001',
        summary: 'Marker missing',
        totalTime: Date.now() - startTime,
      });
    }

    if (contractTarget !== expectedTargetId) {
      return buildVerifyResult({
        ...baseOpts,
        ok: false,
        code: 'PN-RUN-3003',
        summary: 'Target mismatch',
        marker,
        actualTargetId: contractTarget,
        totalTime: Date.now() - startTime,
      });
    }

    if (marker.storageHash !== contractStorageHash) {
      return buildVerifyResult({
        ...baseOpts,
        ok: false,
        code: 'PN-RUN-3002',
        summary: 'Hash mismatch',
        marker,
        totalTime: Date.now() - startTime,
      });
    }

    if (contractProfileHash && marker.profileHash !== contractProfileHash) {
      return buildVerifyResult({
        ...baseOpts,
        ok: false,
        code: 'PN-RUN-3002',
        summary: 'Hash mismatch',
        marker,
        totalTime: Date.now() - startTime,
      });
    }

    return buildVerifyResult({
      ...baseOpts,
      ok: true,
      summary: 'Database matches contract',
      marker,
      totalTime: Date.now() - startTime,
    });
  }

  async schemaVerify(options: {
    readonly driver: ControlDriverInstance<'mongo', string>;
    readonly contract: unknown;
    readonly strict: boolean;
    readonly contractPath: string;
    readonly configPath?: string;
    readonly frameworkComponents: ReadonlyArray<unknown>;
  }): Promise<VerifyDatabaseSchemaResult> {
    const { driver, contract: rawContract, strict, contractPath, configPath } = options;
    const startTime = Date.now();

    const validated = validateMongoContract<MongoContract>(rawContract);
    const contract = validated.contract;

    const db = extractDb(driver);
    const liveIR = await introspectSchema(db);
    const expectedIR = contractToMongoSchemaIR(contract);

    const { root, issues, counts } = diffMongoSchemas(liveIR, expectedIR, strict);

    const ok = counts.fail === 0;

    return {
      ok,
      ...(ok ? {} : { code: 'PN-RUN-3010' }),
      summary: ok ? 'Schema matches contract' : `Schema verification found ${counts.fail} issue(s)`,
      contract: {
        storageHash: contract.storage.storageHash,
        ...(contract.profileHash ? { profileHash: contract.profileHash } : {}),
      },
      target: { expected: contract.target },
      schema: { issues, root, counts },
      meta: {
        ...(contractPath ? { contractPath } : {}),
        ...(configPath ? { configPath } : {}),
        strict,
      },
      timings: { total: Date.now() - startTime },
    };
  }

  async sign(_options: {
    readonly driver: ControlDriverInstance<'mongo', string>;
    readonly contract: unknown;
    readonly contractPath: string;
    readonly configPath?: string;
  }): Promise<SignDatabaseResult> {
    throw new Error('Mongo sign is not implemented');
  }

  async readMarker(options: {
    readonly driver: ControlDriverInstance<'mongo', string>;
  }): Promise<ContractMarkerRecord | null> {
    const db = extractDb(options.driver);
    const doc = await db
      .collection(MIGRATIONS_COLLECTION)
      .findOne({ _id: MARKER_ID } as Record<string, unknown>);
    if (!doc) return null;
    return {
      storageHash: doc['storageHash'] as string,
      profileHash: doc['profileHash'] as string,
      contractJson: (doc['contractJson'] as unknown) ?? null,
      canonicalVersion: (doc['canonicalVersion'] as number) ?? null,
      updatedAt: doc['updatedAt'] as Date,
      appTag: (doc['appTag'] as string) ?? null,
      meta: (doc['meta'] as Record<string, unknown>) ?? {},
    };
  }

  async introspect(options: {
    readonly driver: ControlDriverInstance<'mongo', string>;
    readonly contract?: unknown;
  }): Promise<MongoSchemaIR> {
    const db = extractDb(options.driver);
    return introspectSchema(db);
  }

  toSchemaView(schema: MongoSchemaIR): CoreSchemaView {
    const collectionNodes: SchemaTreeNode[] = Object.entries(schema.collections).map(
      ([name, collection]) => collectionToSchemaNode(name, collection),
    );

    return {
      root: {
        kind: 'root',
        id: 'mongo-schema',
        label: 'contract',
        ...(collectionNodes.length > 0 ? { children: collectionNodes } : {}),
      },
    };
  }
}

function buildVerifyResult(opts: {
  ok: boolean;
  code?: string;
  summary: string;
  contractStorageHash: string;
  contractProfileHash?: string;
  marker?: ContractMarkerRecord;
  expectedTargetId: string;
  actualTargetId?: string;
  contractPath: string;
  configPath?: string;
  totalTime: number;
}): VerifyDatabaseResult {
  return {
    ok: opts.ok,
    ...(opts.code ? { code: opts.code } : {}),
    summary: opts.summary,
    contract: {
      storageHash: opts.contractStorageHash,
      ...(opts.contractProfileHash ? { profileHash: opts.contractProfileHash } : {}),
    },
    ...(opts.marker
      ? { marker: { storageHash: opts.marker.storageHash, profileHash: opts.marker.profileHash } }
      : {}),
    target: {
      expected: opts.expectedTargetId,
      ...(opts.actualTargetId ? { actual: opts.actualTargetId } : {}),
    },
    meta: {
      contractPath: opts.contractPath,
      ...(opts.configPath ? { configPath: opts.configPath } : {}),
    },
    timings: { total: opts.totalTime },
  };
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

function diffMongoSchemas(
  live: MongoSchemaIR,
  expected: MongoSchemaIR,
  strict: boolean,
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

  const allNames = new Set([
    ...Object.keys(live.collections),
    ...Object.keys(expected.collections),
  ]);

  for (const name of [...allNames].sort()) {
    const liveColl = live.collections[name];
    const expectedColl = expected.collections[name];

    if (!liveColl && expectedColl) {
      issues.push({
        kind: 'missing_table',
        table: name,
        message: `Collection "${name}" is missing from the database`,
      });
      collectionChildren.push({
        status: 'fail',
        kind: 'collection',
        name,
        contractPath: `storage.collections.${name}`,
        code: 'MISSING_COLLECTION',
        message: `Collection "${name}" is missing`,
        expected: name,
        actual: null,
        children: [],
      });
      fail++;
      continue;
    }

    if (liveColl && !expectedColl) {
      const status = strict ? 'fail' : 'warn';
      issues.push({
        kind: 'extra_table',
        table: name,
        message: `Extra collection "${name}" exists in the database but not in the contract`,
      });
      collectionChildren.push({
        status,
        kind: 'collection',
        name,
        contractPath: `storage.collections.${name}`,
        code: 'EXTRA_COLLECTION',
        message: `Extra collection "${name}" found`,
        expected: null,
        actual: name,
        children: [],
      });
      if (status === 'fail') fail++;
      else warn++;
      continue;
    }

    const indexChildren = diffIndexes(name, liveColl!, expectedColl!, strict, issues);
    const validatorChildren = diffValidator(name, liveColl!, expectedColl!, issues);
    const optionsChildren = diffOptions(name, liveColl!, expectedColl!, issues);
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
      contractPath: `storage.collections.${name}`,
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

function diffIndexes(
  collName: string,
  live: MongoSchemaCollection,
  expected: MongoSchemaCollection,
  strict: boolean,
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
        contractPath: `storage.collections.${collName}.indexes`,
        code: 'MATCH',
        message: `Index ${formatIndexName(idx)} matches`,
        expected: key,
        actual: key,
        children: [],
      });
    } else {
      issues.push({
        kind: 'index_mismatch',
        table: collName,
        indexOrConstraint: formatIndexName(idx),
        message: `Index ${formatIndexName(idx)} missing on collection "${collName}"`,
      });
      nodes.push({
        status: 'fail',
        kind: 'index',
        name: formatIndexName(idx),
        contractPath: `storage.collections.${collName}.indexes`,
        code: 'MISSING_INDEX',
        message: `Index ${formatIndexName(idx)} missing`,
        expected: key,
        actual: null,
        children: [],
      });
    }
  }

  for (const [key, idx] of liveLookup) {
    if (!expectedLookup.has(key)) {
      const status = strict ? 'fail' : 'warn';
      issues.push({
        kind: 'extra_index',
        table: collName,
        indexOrConstraint: formatIndexName(idx),
        message: `Extra index ${formatIndexName(idx)} on collection "${collName}"`,
      });
      nodes.push({
        status,
        kind: 'index',
        name: formatIndexName(idx),
        contractPath: `storage.collections.${collName}.indexes`,
        code: 'EXTRA_INDEX',
        message: `Extra index ${formatIndexName(idx)}`,
        expected: null,
        actual: key,
        children: [],
      });
    }
  }

  return nodes;
}

function diffValidator(
  collName: string,
  live: MongoSchemaCollection,
  expected: MongoSchemaCollection,
  issues: SchemaIssue[],
): SchemaVerificationNode[] {
  if (!live.validator && !expected.validator) return [];

  if (expected.validator && !live.validator) {
    issues.push({
      kind: 'type_missing',
      table: collName,
      message: `Validator missing on collection "${collName}"`,
    });
    return [
      {
        status: 'fail',
        kind: 'validator',
        name: 'validator',
        contractPath: `storage.collections.${collName}.validator`,
        code: 'MISSING_VALIDATOR',
        message: 'Validator missing',
        expected: canonicalize(expected.validator.jsonSchema),
        actual: null,
        children: [],
      },
    ];
  }

  if (!expected.validator && live.validator) {
    return [
      {
        status: 'warn',
        kind: 'validator',
        name: 'validator',
        contractPath: `storage.collections.${collName}.validator`,
        code: 'EXTRA_VALIDATOR',
        message: 'Extra validator found',
        expected: null,
        actual: canonicalize(live.validator.jsonSchema),
        children: [],
      },
    ];
  }

  const liveSchema = canonicalize(live.validator!.jsonSchema);
  const expectedSchema = canonicalize(expected.validator!.jsonSchema);

  if (
    liveSchema !== expectedSchema ||
    live.validator!.validationLevel !== expected.validator!.validationLevel ||
    live.validator!.validationAction !== expected.validator!.validationAction
  ) {
    issues.push({
      kind: 'type_mismatch',
      table: collName,
      expected: expectedSchema,
      actual: liveSchema,
      message: `Validator mismatch on collection "${collName}"`,
    });
    return [
      {
        status: 'fail',
        kind: 'validator',
        name: 'validator',
        contractPath: `storage.collections.${collName}.validator`,
        code: 'VALIDATOR_MISMATCH',
        message: 'Validator mismatch',
        expected: {
          jsonSchema: expected.validator!.jsonSchema,
          validationLevel: expected.validator!.validationLevel,
          validationAction: expected.validator!.validationAction,
        },
        actual: {
          jsonSchema: live.validator!.jsonSchema,
          validationLevel: live.validator!.validationLevel,
          validationAction: live.validator!.validationAction,
        },
        children: [],
      },
    ];
  }

  return [
    {
      status: 'pass',
      kind: 'validator',
      name: 'validator',
      contractPath: `storage.collections.${collName}.validator`,
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
  issues: SchemaIssue[],
): SchemaVerificationNode[] {
  if (!live.options && !expected.options) return [];
  if (deepEqual(live.options, expected.options)) {
    return [
      {
        status: 'pass',
        kind: 'options',
        name: 'options',
        contractPath: `storage.collections.${collName}.options`,
        code: 'MATCH',
        message: 'Collection options match',
        expected: canonicalize(expected.options),
        actual: canonicalize(live.options),
        children: [],
      },
    ];
  }

  issues.push({
    kind: 'type_mismatch',
    table: collName,
    expected: canonicalize(expected.options),
    actual: canonicalize(live.options),
    message: `Collection options mismatch on "${collName}"`,
  });
  return [
    {
      status: 'fail',
      kind: 'options',
      name: 'options',
      contractPath: `storage.collections.${collName}.options`,
      code: 'OPTIONS_MISMATCH',
      message: 'Collection options mismatch',
      expected: expected.options,
      actual: live.options,
      children: [],
    },
  ];
}

function formatIndexName(index: MongoSchemaIndex): string {
  return index.keys.map((k) => `${k.field}:${k.direction}`).join(', ');
}

function collectionToSchemaNode(name: string, collection: MongoSchemaCollection): SchemaTreeNode {
  const children: SchemaTreeNode[] = [];

  for (const index of collection.indexes) {
    const keysSummary = index.keys.map((k) => `${k.field}: ${k.direction}`).join(', ');
    const prefix = index.unique ? 'unique index' : 'index';
    const options: string[] = [];
    if (index.sparse) options.push('sparse');
    if (index.expireAfterSeconds != null) options.push(`ttl: ${index.expireAfterSeconds}s`);
    if (index.partialFilterExpression) options.push('partial');
    const optsSuffix = options.length > 0 ? ` (${options.join(', ')})` : '';

    children.push({
      kind: 'index',
      id: `index-${name}-${index.keys.map((k) => `${k.field}_${k.direction}`).join('_')}`,
      label: `${prefix} (${keysSummary})${optsSuffix}`,
      meta: {
        keys: index.keys,
        unique: index.unique,
        ...(index.sparse ? { sparse: index.sparse } : {}),
        ...(index.expireAfterSeconds != null
          ? { expireAfterSeconds: index.expireAfterSeconds }
          : {}),
        ...(index.partialFilterExpression
          ? { partialFilterExpression: index.partialFilterExpression }
          : {}),
      },
    });
  }

  if (collection.validator) {
    children.push({
      kind: 'field',
      id: `validator-${name}`,
      label: `validator (${collection.validator.validationLevel}, ${collection.validator.validationAction})`,
      meta: {
        validationLevel: collection.validator.validationLevel,
        validationAction: collection.validator.validationAction,
        jsonSchema: collection.validator.jsonSchema,
      },
    });
  }

  if (collection.options) {
    const opts = collection.options;
    const optLabels: string[] = [];
    if (opts.capped) optLabels.push('capped');
    if (opts.timeseries) optLabels.push('timeseries');
    if (opts.collation) optLabels.push('collation');
    if (opts.changeStreamPreAndPostImages) optLabels.push('changeStreamPreAndPostImages');
    if (opts.clusteredIndex) optLabels.push('clusteredIndex');

    if (optLabels.length > 0) {
      children.push({
        kind: 'field',
        id: `options-${name}`,
        label: `options (${optLabels.join(', ')})`,
        meta: {
          ...(opts.capped ? { capped: opts.capped } : {}),
          ...(opts.timeseries ? { timeseries: opts.timeseries } : {}),
          ...(opts.collation ? { collation: opts.collation } : {}),
          ...(opts.changeStreamPreAndPostImages
            ? { changeStreamPreAndPostImages: opts.changeStreamPreAndPostImages }
            : {}),
          ...(opts.clusteredIndex ? { clusteredIndex: opts.clusteredIndex } : {}),
        },
      });
    }
  }

  return {
    kind: 'collection',
    id: `collection-${name}`,
    label: `collection ${name}`,
    ...(children.length > 0 ? { children } : {}),
  };
}

export function createMongoFamilyInstance(_controlStack: ControlStack): MongoControlFamilyInstance {
  return new MongoFamilyInstance();
}
