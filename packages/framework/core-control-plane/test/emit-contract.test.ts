import type { ContractIR } from '@prisma-next/contract/ir';
import { contractIR, irHeader, irMeta } from '@prisma-next/contract/ir';
import type { TargetFamilyHook } from '@prisma-next/emitter';
import { createOperationRegistry } from '@prisma-next/operations';
import { describe, expect, it, vi } from 'vitest';
import { emitContract } from '../src/actions/emit-contract';

// Mock target family hook
const mockTargetFamilyHook: TargetFamilyHook = {
  validateTypes: vi.fn(),
  validateStructure: vi.fn(),
  generateContractTypes: vi.fn(() => 'export type Contract = {};'),
} as unknown as TargetFamilyHook;

describe('emitContract', () => {
  it('returns contract JSON and DTS as strings', async () => {
    const testContractIR: ContractIR = contractIR({
      header: irHeader({
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:test',
      }),
      meta: irMeta({}),
      storage: {
        tables: {
          user: {
            columns: {
              id: { type: 'pg/int4@1', nullable: false },
              email: { type: 'pg/text@1', nullable: false },
            },
          },
        },
      },
      models: {},
      relations: {},
    });

    const operationRegistry = createOperationRegistry();
    const codecTypeImports: never[] = [];
    const operationTypeImports: never[] = [];
    const extensionIds: string[] = [];

    const result = await emitContract({
      contractIR: testContractIR,
      targetFamily: mockTargetFamilyHook,
      operationRegistry,
      codecTypeImports,
      operationTypeImports,
      extensionIds,
    });

    expect(result.contractJson).toBeDefined();
    expect(typeof result.contractJson).toBe('string');
    expect(result.contractDts).toBeDefined();
    expect(typeof result.contractDts).toBe('string');
    expect(result.coreHash).toBeDefined();
    expect(typeof result.coreHash).toBe('string');
    expect(result.profileHash).toBeDefined();
    expect(typeof result.profileHash).toBe('string');

    // Verify JSON is valid
    const parsed = JSON.parse(result.contractJson);
    expect(parsed).toMatchObject({
      targetFamily: 'sql',
      target: 'postgres',
      coreHash: expect.any(String),
    });

    // Verify DTS contains expected content
    expect(result.contractDts).toContain('export type Contract');
  });

  it('includes profileHash in result', async () => {
    const testContractIR: ContractIR = contractIR({
      header: irHeader({
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:test',
        profileHash: 'sha256:profile',
      }),
      meta: irMeta({}),
      storage: { tables: {} },
      models: {},
      relations: {},
    });

    const operationRegistry = createOperationRegistry();
    const codecTypeImports: never[] = [];
    const operationTypeImports: never[] = [];
    const extensionIds: string[] = [];

    const result = await emitContract({
      contractIR: testContractIR,
      targetFamily: mockTargetFamilyHook,
      operationRegistry,
      codecTypeImports,
      operationTypeImports,
      extensionIds,
    });

    expect(result.profileHash).toBeDefined();
    expect(typeof result.profileHash).toBe('string');
  });

  it('handles non-Error exceptions', async () => {
    const testContractIR: ContractIR = contractIR({
      header: irHeader({
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:test',
      }),
      meta: irMeta({}),
      storage: { tables: {} },
      models: {},
      relations: {},
    });

    const operationRegistry = createOperationRegistry();
    const codecTypeImports: never[] = [];
    const operationTypeImports: never[] = [];
    const extensionIds: string[] = [];

    // Mock targetFamilyHook to throw a non-Error
    const throwingHook = {
      validateTypes: vi.fn(),
      validateStructure: vi.fn(() => {
        throw 'String error';
      }),
      generateContractTypes: vi.fn(() => 'export type Contract = {};'),
    } as unknown as TargetFamilyHook;

    await expect(
      emitContract({
        contractIR: testContractIR,
        targetFamily: throwingHook,
        operationRegistry,
        codecTypeImports,
        operationTypeImports,
        extensionIds,
      }),
    ).rejects.toThrow('Failed to emit contract: String error');
  });
});
