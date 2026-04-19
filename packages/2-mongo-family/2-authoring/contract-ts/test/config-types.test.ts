import type { ContractSourceContext } from '@prisma-next/config/config-types';
import type { Contract } from '@prisma-next/contract/types';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { typescriptContract } from '../src/config-types';

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
    const result = await config.source(emptyContext);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value).toBe(contract);
    expect(config.output).toBe('output/contract.json');
    expect(config.watchStrategy).toBe('moduleGraph');
  });

  it('omits output when not provided', () => {
    const contract = { targetFamily: 'mongo', target: 'mongo' } as unknown as Contract;
    const config = typescriptContract(contract);

    expect(config.output).toBeUndefined();
    expect(config.watchStrategy).toBe('moduleGraph');
  });
});
