import { createContract } from '@prisma-next/contract/testing';
import type { Contract } from '@prisma-next/contract/types';

export function createContractIR(
  overrides: Partial<Contract> & {
    storageHash?: string;
    schemaVersion?: string;
    sources?: Record<string, unknown>;
    storage?: Record<string, unknown>;
    models?: Record<string, unknown>;
  } = {},
): Contract {
  const { storageHash: _sh, schemaVersion: _sv, sources: _src, ...contractOverrides } = overrides;
  return createContract(contractOverrides);
}
