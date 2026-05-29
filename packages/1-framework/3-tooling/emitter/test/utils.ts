import { createContract } from '@prisma-next/contract/testing';
import type { Contract, CrossReference } from '@prisma-next/contract/types';
import type { EmissionSpi } from '@prisma-next/framework-components/emission';
import { sqlContractCanonicalizationHooks } from '@prisma-next/sql-contract/canonicalization-hooks';
import type { JsonObject } from '@prisma-next/utils/json';
import type { EmitOptions, EmitResult, EmitStackInput } from '../src/exports';
import { emit as emitImpl } from '../src/exports';

const identitySerialize = (c: Contract): JsonObject => c as unknown as JsonObject;

/**
 * Tests author JSON-clean contracts directly, so the canonicalisation
 * hook trivially passes through. Production callers thread the target
 * descriptor's `contractSerializer.serializeContract` instead.
 * SQL-shaped test contracts also thread the SQL family's canonicalization
 * hooks so emitted bytes match production emit.
 */
export function emit(
  contract: Contract,
  stack: EmitStackInput,
  family: EmissionSpi,
  options?: Omit<EmitOptions, 'serializeContract'>,
): Promise<EmitResult> {
  return emitImpl(contract, stack, family, {
    ...sqlContractCanonicalizationHooks,
    ...options,
    serializeContract: identitySerialize,
  });
}

type TestContractOverrides = {
  target?: string;
  targetFamily?: string;
  roots?: Record<string, CrossReference>;
  models?: Record<string, unknown>;
  storage?: Record<string, unknown>;
  capabilities?: Record<string, Record<string, boolean>>;
  extensionPacks?: Record<string, unknown>;
  execution?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  storageHash?: string;
  schemaVersion?: string;
  sources?: Record<string, unknown>;
};

export function createTestContract(overrides: TestContractOverrides = {}): Contract {
  const { storageHash: _sh, schemaVersion: _sv, sources: _src, storage, ...rest } = overrides;
  const cleanStorage = storage
    ? (() => {
        const { storageHash: _innerSh, ...storageRest } = storage as Record<string, unknown>;
        return storageRest;
      })()
    : undefined;
  return createContract({
    ...rest,
    ...(cleanStorage ? { storage: cleanStorage } : {}),
  } as Parameters<typeof createContract>[0]);
}
