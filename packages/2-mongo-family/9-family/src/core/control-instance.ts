import {
  contractToMongoSchemaIR,
  initMarker,
  introspectSchema,
  readMarker,
  updateMarker,
} from '@prisma-next/adapter-mongo/control';
import type { Contract, ContractMarkerRecord } from '@prisma-next/contract/types';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  ControlStack,
  CoreSchemaView,
  SchemaTreeNode,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import type { MongoContract } from '@prisma-next/mongo-contract';
import { validateMongoContract } from '@prisma-next/mongo-contract';
import type { MongoSchemaCollection, MongoSchemaIR } from '@prisma-next/mongo-schema-ir';
import type { Db } from 'mongodb';
import { diffMongoSchemas } from './schema-diff';

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

    const baseOpts = {
      contractStorageHash,
      contractProfileHash,
      expectedTargetId,
      contractPath,
      ...(configPath ? { configPath } : {}),
    };

    if (contractTarget !== expectedTargetId) {
      return buildVerifyResult({
        ...baseOpts,
        ok: false,
        code: 'PN-RUN-3003',
        summary: 'Target mismatch',
        actualTargetId: contractTarget,
        totalTime: Date.now() - startTime,
      });
    }

    const db = extractDb(driver);
    const marker = await readMarker(db);

    if (!marker) {
      return buildVerifyResult({
        ...baseOpts,
        ok: false,
        code: 'PN-RUN-3001',
        summary: 'Marker missing',
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

  async sign(options: {
    readonly driver: ControlDriverInstance<'mongo', string>;
    readonly contract: unknown;
    readonly contractPath: string;
    readonly configPath?: string;
  }): Promise<SignDatabaseResult> {
    const { driver, contract: rawContract, contractPath, configPath } = options;
    const startTime = Date.now();

    const validated = validateMongoContract<MongoContract>(rawContract);
    const contract = validated.contract;

    const contractStorageHash = contract.storage.storageHash;
    const contractProfileHash = contract.profileHash ?? contractStorageHash;

    const db = extractDb(driver);

    const existingMarker = await readMarker(db);

    let markerCreated = false;
    let markerUpdated = false;
    let previousHashes: { storageHash?: string; profileHash?: string } | undefined;

    if (!existingMarker) {
      await initMarker(db, {
        storageHash: contractStorageHash,
        profileHash: contractProfileHash,
      });
      markerCreated = true;
    } else {
      const storageHashMatches = existingMarker.storageHash === contractStorageHash;
      const profileHashMatches = existingMarker.profileHash === contractProfileHash;

      if (!storageHashMatches || !profileHashMatches) {
        previousHashes = {
          storageHash: existingMarker.storageHash,
          profileHash: existingMarker.profileHash,
        };
        const updated = await updateMarker(db, existingMarker.storageHash, {
          storageHash: contractStorageHash,
          profileHash: contractProfileHash,
        });
        if (!updated) {
          throw new Error('CAS conflict: marker was modified by another process during sign');
        }
        markerUpdated = true;
      }
    }

    let summary: string;
    if (markerCreated) {
      summary = 'Database signed (marker created)';
    } else if (markerUpdated) {
      summary = `Database signed (marker updated from ${previousHashes?.storageHash ?? 'unknown'})`;
    } else {
      summary = 'Database already signed with this contract';
    }

    return {
      ok: true,
      summary,
      contract: {
        storageHash: contractStorageHash,
        profileHash: contractProfileHash,
      },
      target: {
        expected: contract.target,
        actual: contract.target,
      },
      marker: {
        created: markerCreated,
        updated: markerUpdated,
        ...(previousHashes ? { previous: previousHashes } : {}),
      },
      meta: {
        contractPath,
        ...(configPath ? { configPath } : {}),
      },
      timings: {
        total: Date.now() - startTime,
      },
    };
  }

  async readMarker(options: {
    readonly driver: ControlDriverInstance<'mongo', string>;
  }): Promise<ContractMarkerRecord | null> {
    const db = extractDb(options.driver);
    return readMarker(db);
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
