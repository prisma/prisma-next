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
      load: async (context) => {
        const [absolutePath] = context.resolvedInputs;
        if (absolutePath === undefined) {
          throw new Error(
            'typescriptContractFromPath: context.resolvedInputs is empty. The CLI config loader should populate it positional-matched with source.inputs.',
          );
        }
        const mod = await import(pathToFileURL(absolutePath).href);
        const contract: Contract | undefined = mod.default ?? mod.contract;
        if (contract === undefined) {
          throw new Error(
            `typescriptContractFromPath: module at "${absolutePath}" has no "default" or "contract" export.`,
          );
        }
        return ok(contract);
      },
    },
    ...ifDefined('output', output),
  };
}
