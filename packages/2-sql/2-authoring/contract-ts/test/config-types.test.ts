import type { ContractIR } from '@prisma-next/contract/ir';
import { describe, expect, it } from 'vitest';
import { typescriptContract } from '../src/config-types';

describe('typescriptContract', () => {
  it('returns provider result with contract IR', async () => {
    const contractIR = { targetFamily: 'sql', target: 'postgres' } as ContractIR;
    const config = typescriptContract(contractIR, 'output/contract.json');
    const result = await config.source({ composedExtensionPacks: [] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toBe(contractIR);
    expect(config.output).toBe('output/contract.json');
  });

  it('omits output when not provided', () => {
    const contractIR = { targetFamily: 'sql', target: 'postgres' } as ContractIR;
    const config = typescriptContract(contractIR);

    expect(config.output).toBeUndefined();
  });
});
