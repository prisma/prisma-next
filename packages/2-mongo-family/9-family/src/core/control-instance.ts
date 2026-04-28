import { introspectSchema } from '@prisma-next/adapter-mongo/control';
import type { Contract, ContractMarkerRecord } from '@prisma-next/contract/types';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  ControlStack,
  CoreSchemaView,
  SchemaViewCapable,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import {
  VERIFY_CODE_HASH_MISMATCH,
  VERIFY_CODE_MARKER_MISSING,
  VERIFY_CODE_TARGET_MISMATCH,
} from '@prisma-next/framework-components/control';
import type { MongoContract } from '@prisma-next/mongo-contract';
import { validateMongoContract } from '@prisma-next/mongo-contract';
import type { MongoSchemaIR } from '@prisma-next/mongo-schema-ir';
import { initMarker, readMarker, updateMarker } from '@prisma-next/target-mongo/control';
import { verifyMongoSchema } from '@prisma-next/target-mongo/schema-verify';
import { ifDefined } from '@prisma-next/utils/defined';
import type { Db } from 'mongodb';
import { mongoSchemaToView } from './schema-to-view';

export interface MongoControlFamilyInstance
  extends ControlFamilyInstance<'mongo', MongoSchemaIR>,
    SchemaViewCapable<MongoSchemaIR> {
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
      ...ifDefined('configPath', configPath),
    };

    if (contractTarget !== expectedTargetId) {
      return buildVerifyResult({
        ...baseOpts,
        ok: false,
        code: VERIFY_CODE_TARGET_MISMATCH,
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
        code: VERIFY_CODE_MARKER_MISSING,
        summary: 'Marker missing',
        totalTime: Date.now() - startTime,
      });
    }

    if (marker.storageHash !== contractStorageHash) {
      return buildVerifyResult({
        ...baseOpts,
        ok: false,
        code: VERIFY_CODE_HASH_MISMATCH,
        summary: 'Hash mismatch',
        marker,
        totalTime: Date.now() - startTime,
      });
    }

    if (contractProfileHash && marker.profileHash !== contractProfileHash) {
      return buildVerifyResult({
        ...baseOpts,
        ok: false,
        code: VERIFY_CODE_HASH_MISMATCH,
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
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'mongo', string>>;
  }): Promise<VerifyDatabaseSchemaResult> {
    const { driver, contract: rawContract, strict, contractPath, configPath } = options;

    const validated = validateMongoContract<MongoContract>(rawContract);
    const contract = validated.contract;

    const db = extractDb(driver);
    const liveIR = await introspectSchema(db);

    return verifyMongoSchema({
      contract,
      schema: liveIR,
      strict,
      frameworkComponents: options.frameworkComponents,
      context: {
        contractPath,
        ...ifDefined('configPath', configPath),
      },
    });
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
    const contractProfileHash = contract.profileHash;

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
        ...ifDefined('previous', previousHashes),
      },
      meta: {
        contractPath,
        ...ifDefined('configPath', configPath),
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
    return mongoSchemaToView(schema);
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
    ...ifDefined('code', opts.code),
    summary: opts.summary,
    contract: {
      storageHash: opts.contractStorageHash,
      ...ifDefined('profileHash', opts.contractProfileHash),
    },
    ...ifDefined(
      'marker',
      opts.marker
        ? { storageHash: opts.marker.storageHash, profileHash: opts.marker.profileHash }
        : undefined,
    ),
    target: {
      expected: opts.expectedTargetId,
      ...ifDefined('actual', opts.actualTargetId),
    },
    meta: {
      contractPath: opts.contractPath,
      ...ifDefined('configPath', opts.configPath),
    },
    timings: { total: opts.totalTime },
  };
}

export function createMongoFamilyInstance(_controlStack: ControlStack): MongoControlFamilyInstance {
  return new MongoFamilyInstance();
}
