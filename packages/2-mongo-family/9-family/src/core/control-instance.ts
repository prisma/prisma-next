import { introspectSchema } from '@prisma-next/adapter-mongo/control';
import type { Contract, ContractMarkerRecord } from '@prisma-next/contract/types';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
  ControlStack,
  CoreSchemaView,
  MigrationPlanOperation,
  OperationPreview,
  OperationPreviewCapable,
  SchemaViewCapable,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import {
  APP_SPACE_ID,
  VERIFY_CODE_HASH_MISMATCH,
  VERIFY_CODE_MARKER_MISSING,
  VERIFY_CODE_TARGET_MISMATCH,
} from '@prisma-next/framework-components/control';
import { assertDescriptorSelfConsistency } from '@prisma-next/migration-tools/spaces';
import type { MongoSchemaIR } from '@prisma-next/mongo-schema-ir';
import {
  formatMongoOperations,
  initMarker,
  type MongoTargetContract,
  readAllMarkers,
  readMarker,
  updateMarker,
} from '@prisma-next/target-mongo/control';
import { verifyMongoSchema } from '@prisma-next/target-mongo/schema-verify';
import { ifDefined } from '@prisma-next/utils/defined';
import type { Db } from 'mongodb';
import type { MongoControlExtensionDescriptor } from './control-types';
import { mongoTargetDescriptor } from './mongo-target-descriptor';
import { mongoSchemaToView } from './schema-to-view';

export interface MongoControlFamilyInstance
  extends ControlFamilyInstance<'mongo', MongoSchemaIR>,
    SchemaViewCapable<MongoSchemaIR>,
    OperationPreviewCapable {
  /**
   * Deprecated since M2 R1; kept on the public surface for SQL parity
   * until FR8 finishes for all targets. Internally delegates to
   * `mongoTargetDescriptor.contractSerializer.deserializeContract`.
   */
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

function deserializeMongoContract(contractJson: unknown): MongoTargetContract {
  return mongoTargetDescriptor.contractSerializer.deserializeContract(contractJson);
}

/**
 * Family-method contract input. By the time control-plane methods
 * (`verify`, `schemaVerify`, `sign`, …) are invoked through the CLI
 * control client (`client.ts`), the input has already been threaded
 * through `familyInstance.validateContract` (which delegates to
 * `mongoTargetDescriptor.contractSerializer.deserializeContract`). The
 * value is therefore a class-form `MongoTargetContract` carrying a
 * `MongoTargetStorage` envelope with `namespaces` populated, and must
 * NOT be re-fed through `deserializeContract` (arktype rejects the
 * extra `namespaces` key on the JSON envelope shape).
 *
 * The parameter type on the framework SPI is `unknown` for variance
 * reasons (so the family can express its own contract type without
 * leaking it to the framework). This helper recovers the validated
 * shape with a single narrow cast.
 */
function asValidatedMongoContract(contract: unknown): MongoTargetContract {
  return contract as MongoTargetContract;
}

class MongoFamilyInstance implements MongoControlFamilyInstance {
  readonly familyId = 'mongo' as const;

  validateContract(contractJson: unknown): Contract {
    // The class form (MongoTargetContract) and the framework Contract are
    // structurally compatible — same fields, just a class instance on the
    // storage envelope. The cast preserves the framework signature.
    return deserializeMongoContract(contractJson) as unknown as Contract;
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

    const contract = asValidatedMongoContract(rawContract);

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
    const marker = await readMarker(db, APP_SPACE_ID);

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

    const contract = asValidatedMongoContract(rawContract);

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

  schemaVerifyAgainstSchema(options: {
    readonly contract: unknown;
    readonly schema: MongoSchemaIR;
    readonly strict: boolean;
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'mongo', string>>;
  }): VerifyDatabaseSchemaResult {
    const contract = asValidatedMongoContract(options.contract);
    return verifyMongoSchema({
      contract,
      schema: options.schema,
      strict: options.strict,
      frameworkComponents: options.frameworkComponents,
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

    const contract = asValidatedMongoContract(rawContract);

    const contractStorageHash = contract.storage.storageHash;
    const contractProfileHash = contract.profileHash;

    const db = extractDb(driver);

    const existingMarker = await readMarker(db, APP_SPACE_ID);

    let markerCreated = false;
    let markerUpdated = false;
    let previousHashes: { storageHash?: string; profileHash?: string } | undefined;

    if (!existingMarker) {
      await initMarker(db, APP_SPACE_ID, {
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
        const updated = await updateMarker(db, APP_SPACE_ID, existingMarker.storageHash, {
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
    readonly space: string;
  }): Promise<ContractMarkerRecord | null> {
    const db = extractDb(options.driver);
    return readMarker(db, options.space);
  }

  async readAllMarkers(options: {
    readonly driver: ControlDriverInstance<'mongo', string>;
  }): Promise<ReadonlyMap<string, ContractMarkerRecord>> {
    const db = extractDb(options.driver);
    return readAllMarkers(db);
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

  toOperationPreview(operations: readonly MigrationPlanOperation[]): OperationPreview {
    return {
      statements: formatMongoOperations(operations).map((text) => ({
        text,
        language: 'mongodb-shell',
      })),
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

export function createMongoFamilyInstance(controlStack: ControlStack): MongoControlFamilyInstance {
  // Descriptor self-consistency check.
  // Each extension that exposes a `contractSpace` must publish a
  // `headRef.hash` that matches the canonical hash recomputed from its
  // `contractJson`. A stale value would silently corrupt every downstream
  // boundary that trusts `headRef.hash` as the canonical identity (drift
  // detection, on-disk artefact emission, runner marker writes). Failing
  // fast at descriptor-load time turns "extension author shipped an
  // inconsistent descriptor" into an explicit, actionable error
  // (`MIGRATION.DESCRIPTOR_HEAD_HASH_MISMATCH`) rather than a confusing
  // mismatch surfacing several layers downstream. Mirrors the SQL family.
  const extensions = (controlStack.extensionPacks ??
    []) as readonly MongoControlExtensionDescriptor[];
  for (const extension of extensions) {
    if (extension.contractSpace) {
      const { contractJson, headRef } = extension.contractSpace;
      assertDescriptorSelfConsistency({
        extensionId: extension.id,
        target: contractJson.target,
        targetFamily: contractJson.targetFamily,
        storage: contractJson.storage,
        headRefHash: headRef.hash,
      });
    }
  }
  return new MongoFamilyInstance();
}
