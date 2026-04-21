import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { ContractSourceContext } from '@prisma-next/config/config-types';
import type { Contract } from '@prisma-next/contract/types';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import { timeouts } from '@prisma-next/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { typescriptContract, typescriptContractFromPath } from '../src/config-types';

const emptyContext: ContractSourceContext = {
  composedExtensionPacks: [],
  scalarTypeDescriptors: new Map(),
  authoringContributions: { field: {}, type: {} },
  codecLookup: emptyCodecLookup,
  controlMutationDefaults: {
    defaultFunctionRegistry: new Map(),
    generatorDescriptors: [],
  },
};

describe('typescriptContract', () => {
  it('returns provider result with contract', async () => {
    const contract = { targetFamily: 'mongo', target: 'mongo' } as unknown as Contract;
    const config = typescriptContract(contract, 'output/contract.json');
    const result = await config.source.load(emptyContext, []);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value).toBe(contract);
    expect(config.output).toBe('output/contract.json');
    expect(config.source.inputs).toBeUndefined();
  });

  it('omits output when not provided', () => {
    const contract = { targetFamily: 'mongo', target: 'mongo' } as unknown as Contract;
    const config = typescriptContract(contract);

    expect(config.output).toBeUndefined();
    expect(config.source.inputs).toBeUndefined();
  });

  it(
    'loads a contract module from the resolved input path',
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'mongo-contract-ts-'));
      const contractPath = join(tempDir, 'contract.ts');

      try {
        await writeFile(
          contractPath,
          `export default { targetFamily: 'mongo', target: 'mongo' };\n`,
          'utf-8',
        );

        const config = typescriptContractFromPath('./contract.ts');
        const result = await config.source.load(emptyContext, [contractPath]);

        expect(result.ok).toBe(true);
        if (!result.ok) {
          return;
        }

        expect(result.value).toMatchObject({
          targetFamily: 'mongo',
          target: 'mongo',
        });
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
    timeouts.typeScriptCompilation,
  );
});
