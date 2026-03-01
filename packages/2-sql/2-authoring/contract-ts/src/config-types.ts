import type { ContractIR } from '@prisma-next/contract/ir';
import type { ContractConfig } from '@prisma-next/core-control-plane/config-types';
import { ifDefined } from '@prisma-next/utils/defined';
import { ok } from '@prisma-next/utils/result';

export function typescriptContract(contractIR: ContractIR, output?: string): ContractConfig {
  return {
    source: async () => ok(contractIR),
    ...ifDefined('output', output),
  };
}
