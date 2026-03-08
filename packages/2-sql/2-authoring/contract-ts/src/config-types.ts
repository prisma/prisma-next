import type { ContractConfig } from '@prisma-next/config/config-types';
import type { ContractIR } from '@prisma-next/contract/ir';
import { ifDefined } from '@prisma-next/utils/defined';
import { ok } from '@prisma-next/utils/result';

export function typescriptContract(contractIR: ContractIR, output?: string): ContractConfig {
  return {
    source: async (_context) => ok(contractIR),
    ...ifDefined('output', output),
  };
}
