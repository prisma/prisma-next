import { pathToFileURL } from 'node:url';
import type { ContractConfig } from '@prisma-next/config/config-types';
import type { Contract } from '@prisma-next/contract/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { ok } from '@prisma-next/utils/result';

export function typescriptContract(contract: Contract, output?: string): ContractConfig {
  return {
    source: {
      load: async () => ok(contract),
    },
    ...ifDefined('output', output),
  };
}

export function typescriptContractFromPath(contractPath: string, output?: string): ContractConfig {
  return {
    source: {
      inputs: [contractPath],
      load: async (_context, resolvedInputs) => {
        const [absolutePath = contractPath] = resolvedInputs;
        const mod = await import(pathToFileURL(absolutePath).href);
        const contract: Contract = mod.default ?? mod.contract;
        return ok(contract);
      },
    },
    ...ifDefined('output', output),
  };
}
