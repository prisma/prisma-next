import { pathToFileURL } from 'node:url';
import type { ContractConfig } from '@prisma-next/config/config-types';
import type { Contract } from '@prisma-next/contract/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { ok } from '@prisma-next/utils/result';
import { isAbsolute, resolve } from 'pathe';

export function typescriptContract(contract: Contract, output?: string): ContractConfig {
  return {
    source: {
      load: async (_context, _environment) => ok(contract),
    },
    ...ifDefined('output', output),
  };
}

export function typescriptContractFromPath(contractPath: string, output?: string): ContractConfig {
  return {
    source: {
      inputs: [contractPath],
      load: async (_context, environment) => {
        const absolutePath = isAbsolute(contractPath)
          ? contractPath
          : resolve(environment.configDir, contractPath);
        const mod = await import(pathToFileURL(absolutePath).href);
        const contract: Contract = mod.default ?? mod.contract;
        return ok(contract);
      },
    },
    ...ifDefined('output', output),
  };
}
