import { type ControlPolicy, effectiveControl } from '@prisma-next/contract/types';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import type {
  OperationContext,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import { VERIFY_CODE_SCHEMA_FAILURE } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { MongoCollection, MongoContract } from '@prisma-next/mongo-contract';
import type { MongoSchemaIR } from '@prisma-next/mongo-schema-ir';
import { ifDefined } from '@prisma-next/utils/defined';
import { contractToMongoSchemaIR } from '../contract-to-schema';
import { diffMongoSchemas } from '../schema-diff';
import { canonicalizeSchemasForVerification } from './canonicalize-introspection';

export interface VerifyMongoSchemaOptions {
  readonly contract: MongoContract;
  readonly schema: MongoSchemaIR;
  readonly strict: boolean;
  readonly context?: OperationContext;
  /**
   * Active framework components participating in this composition. Mongo
   * verification does not currently consult them, but the parameter exists
   * for parity with `verifySqlSchema` so callers can pass the same envelope.
   */
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'mongo', string>>;
}

export function verifyMongoSchema(options: VerifyMongoSchemaOptions): VerifyDatabaseSchemaResult {
  const { contract, schema, strict, context } = options;
  const startTime = Date.now();

  const expectedIR = contractToMongoSchemaIR(contract);
  // Strip server-applied defaults (and authored equivalents) before diffing so
  // the verifier compares like-with-like — see `canonicalize-introspection.ts`.
  const { live: canonicalLive, expected: canonicalExpected } = canonicalizeSchemasForVerification(
    schema,
    expectedIR,
  );
  const collectionControl = resolveMongoCollectionControl(contract);
  const { root, issues, counts } = diffMongoSchemas(
    canonicalLive,
    canonicalExpected,
    strict,
    collectionControl,
  );

  const ok = counts.fail === 0;
  const profileHash = typeof contract.profileHash === 'string' ? contract.profileHash : '';

  return {
    ok,
    ...ifDefined('code', ok ? undefined : VERIFY_CODE_SCHEMA_FAILURE),
    summary: ok ? 'Schema matches contract' : `Schema verification found ${counts.fail} issue(s)`,
    contract: {
      storageHash: contract.storage.storageHash,
      ...(profileHash ? { profileHash } : {}),
    },
    target: { expected: contract.target },
    schema: { issues, root, counts },
    meta: {
      strict,
      ...ifDefined('contractPath', context?.contractPath),
      ...ifDefined('configPath', context?.configPath),
    },
    timings: { total: Date.now() - startTime },
  };
}

function resolveMongoCollectionControl(
  contract: MongoContract,
): (collectionName: string) => ControlPolicy {
  const namespace = contract.storage.namespaces[UNBOUND_NAMESPACE_ID];
  const collections: Record<string, MongoCollection> = namespace?.collections ?? {};
  const defaultControl = contract.defaultControl;
  return (collectionName: string) =>
    effectiveControl(collections[collectionName]?.control, defaultControl);
}
