import { introspectSchema } from '@prisma-next/adapter-mongo/control';
import type { Contract, ContractMarkerRecord } from '@prisma-next/contract/types';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  ControlStack,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import type { MongoContract } from '@prisma-next/mongo-contract';
import { validateMongoContract } from '@prisma-next/mongo-contract';
import type { MongoSchemaIR } from '@prisma-next/mongo-schema-ir';
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

  async verify(_options: {
    readonly driver: ControlDriverInstance<'mongo', string>;
    readonly contract: unknown;
    readonly expectedTargetId: string;
    readonly contractPath: string;
    readonly configPath?: string;
  }): Promise<VerifyDatabaseResult> {
    throw new Error('Mongo verify is not implemented');
  }

  async schemaVerify(_options: {
    readonly driver: ControlDriverInstance<'mongo', string>;
    readonly contract: unknown;
    readonly strict: boolean;
    readonly contractPath: string;
    readonly configPath?: string;
    readonly frameworkComponents: ReadonlyArray<unknown>;
  }): Promise<VerifyDatabaseSchemaResult> {
    throw new Error('Mongo schemaVerify is not implemented');
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
}

export function createMongoFamilyInstance(_controlStack: ControlStack): MongoControlFamilyInstance {
  return new MongoFamilyInstance();
}
