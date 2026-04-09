import type { ContractConfig } from '@prisma-next/config/config-types';
import type { Contract } from '@prisma-next/contract/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { ok } from '@prisma-next/utils/result';

export function typescriptContract(contract: Contract, output?: string): ContractConfig {
  return {
    source: async (_context) => ok(contract),
    ...ifDefined('output', output),
  };
}
