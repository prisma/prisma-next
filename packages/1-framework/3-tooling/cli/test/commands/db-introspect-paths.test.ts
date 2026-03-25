import { resolve } from 'pathe';
import { describe, expect, it } from 'vitest';
import { resolveContractInferOutputPath } from '../../src/commands/contract-infer-paths';

describe('resolveContractInferOutputPath', () => {
  it('uses explicit output when provided', () => {
    expect(
      resolveContractInferOutputPath(
        { output: './prisma/custom-contract.prisma' },
        './output/contract.json',
      ),
    ).toBe(resolve(process.cwd(), './prisma/custom-contract.prisma'));
  });

  it('writes contract.prisma alongside the configured contract output', () => {
    expect(resolveContractInferOutputPath({}, './output/contract.json')).toBe(
      resolve(process.cwd(), './output/contract.prisma'),
    );
  });

  it('falls back to contract.prisma in cwd', () => {
    expect(resolveContractInferOutputPath({}, undefined)).toBe(
      resolve(process.cwd(), 'contract.prisma'),
    );
  });
});
