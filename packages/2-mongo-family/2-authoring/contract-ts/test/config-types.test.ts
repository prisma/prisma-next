import type { Contract } from '@prisma-next/contract/types';
import { describe, expect, it } from 'vitest';
import { typescriptContract } from '../src/config-types';

describe('typescriptContract', () => {
  it('returns provider result with contract', async () => {
    const contract = { targetFamily: 'mongo', target: 'mongo' } as unknown as Contract;
    const config = typescriptContract(contract, 'output/contract.json');
    const result = await config.source({ composedExtensionPacks: [] });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value).toBe(contract);
    expect(config.output).toBe('output/contract.json');
  });

  it('omits output when not provided', () => {
    const contract = { targetFamily: 'mongo', target: 'mongo' } as unknown as Contract;
    const config = typescriptContract(contract);

    expect(config.output).toBeUndefined();
  });
});
