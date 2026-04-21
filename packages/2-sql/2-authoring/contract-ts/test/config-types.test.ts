import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { ContractSourceContext } from '@prisma-next/config/config-types';
import type { Contract } from '@prisma-next/contract/types';
import { timeouts } from '@prisma-next/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { typescriptContract, typescriptContractFromPath } from '../src/config-types';

const stubContext: ContractSourceContext = {
  composedExtensionPacks: [],
  scalarTypeDescriptors: new Map(),
  authoringContributions: { field: {}, type: {} },
  codecLookup: { get: () => undefined },
  controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
  resolvedInputs: [],
};

describe('typescriptContract', () => {
  it('returns provider result with contract', async () => {
    const contract = { targetFamily: 'sql', target: 'postgres' } as Contract;
    const config = typescriptContract(contract, 'output/contract.json');
    const result = await config.source.load(stubContext);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toBe(contract);
    expect(config.output).toBe('output/contract.json');
    expect(config.source.inputs).toBeUndefined();
  });

  it('omits output when not provided', () => {
    const contract = { targetFamily: 'sql', target: 'postgres' } as Contract;
    const config = typescriptContract(contract);

    expect(config.output).toBeUndefined();
    expect(config.source.inputs).toBeUndefined();
  });

  it(
    'loads a contract module from the resolved input path',
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'sql-contract-ts-'));
      const contractPath = join(tempDir, 'contract.ts');

      try {
        await writeFile(
          contractPath,
          `export default { targetFamily: 'sql', target: 'postgres' };\n`,
          'utf-8',
        );

        const config = typescriptContractFromPath('./contract.ts');
        const result = await config.source.load({
          ...stubContext,
          resolvedInputs: [contractPath],
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value).toMatchObject({
          targetFamily: 'sql',
          target: 'postgres',
        });
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'throws when the module exports neither default nor contract',
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'sql-contract-ts-'));
      const contractPath = join(tempDir, 'contract.ts');

      try {
        await writeFile(contractPath, 'export const notContract = {};\n', 'utf-8');

        const config = typescriptContractFromPath('./contract.ts');

        await expect(
          config.source.load({
            ...stubContext,
            resolvedInputs: [contractPath],
          }),
        ).rejects.toThrow(/has no "default" or "contract" export/);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
    timeouts.typeScriptCompilation,
  );
});
