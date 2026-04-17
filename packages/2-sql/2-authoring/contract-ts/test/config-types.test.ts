import type { ContractSourceContext } from '@prisma-next/config/config-types';
import type { Contract } from '@prisma-next/contract/types';
import { describe, expect, it } from 'vitest';
import { typescriptContract } from '../src/config-types';

const stubContext: ContractSourceContext = {
  composedExtensionPacks: [],
  scalarTypeDescriptors: new Map(),
  authoringContributions: { field: {}, type: {} },
  codecLookup: { get: () => undefined },
  controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
};

describe('typescriptContract', () => {
  it('returns provider result with contract', async () => {
    const contract = { targetFamily: 'sql', target: 'postgres' } as Contract;
    const config = typescriptContract(contract, 'output/contract.json');
    const result = await config.source(stubContext);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toBe(contract);
    expect(config.output).toBe('output/contract.json');
  });

  it('omits output when not provided', () => {
    const contract = { targetFamily: 'sql', target: 'postgres' } as Contract;
    const config = typescriptContract(contract);

    expect(config.output).toBeUndefined();
  });
});
