import { createContract } from '@prisma-next/contract/testing';
import type { Contract } from '@prisma-next/contract/types';

export function createTestContract(
  overrides: {
    target?: string | undefined;
    targetFamily?: string | undefined;
    roots?: Record<string, string> | undefined;
    models?: Record<string, unknown> | undefined;
    storage?: Record<string, unknown> | undefined;
    capabilities?: Record<string, Record<string, boolean>> | undefined;
    extensionPacks?: Record<string, unknown> | undefined;
    execution?: Record<string, unknown> | undefined;
    meta?: Record<string, unknown> | undefined;
    storageHash?: string | undefined;
    schemaVersion?: string | undefined;
    sources?: Record<string, unknown> | undefined;
  } = {},
): Contract {
  const { storageHash: _sh, schemaVersion: _sv, sources: _src, ...contractOverrides } = overrides;
  return createContract(contractOverrides);
}
