import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadContractFromTs } from '../src/load-ts-contract';
import { emit, loadExtensionPacks, targetFamilyRegistry } from '@prisma-next/emitter';
import { sqlTargetFamilyHook } from '@prisma-next/sql-target';

beforeAll(() => {
  if (!targetFamilyRegistry.has('sql')) {
    targetFamilyRegistry.register(sqlTargetFamilyHook);
  }
});

const fixturesDir = join(__dirname, 'fixtures');

describe('emit command functionality', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = join(tmpdir(), `prisma-next-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(outputDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(outputDir)) {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('loads TS contract and emits contract.json and contract.d.ts', async () => {
    const contractPath = join(fixturesDir, 'valid-contract.ts');
    const adapterPath = resolve(__dirname, '../../adapter-postgres');

    const contract = await loadContractFromTs(contractPath);
    const packs = loadExtensionPacks(adapterPath, []);

    const result = await emit(contract, {
      outputDir,
      packs,
    });

    const contractJsonPath = join(outputDir, 'contract.json');
    const contractDtsPath = join(outputDir, 'contract.d.ts');

    writeFileSync(contractJsonPath, result.contractJson, 'utf-8');
    writeFileSync(contractDtsPath, result.contractDts, 'utf-8');

    expect(existsSync(contractJsonPath)).toBe(true);
    expect(existsSync(contractDtsPath)).toBe(true);

    const contractJson = JSON.parse(readFileSync(contractJsonPath, 'utf-8'));
    expect(contractJson.targetFamily).toBe('sql');
    expect(contractJson.target).toBe('postgres');
    expect(contractJson.storage.tables.user).toBeDefined();

    const contractDts = readFileSync(contractDtsPath, 'utf-8');
    expect(contractDts).toContain('export type Contract');
    expect(contractDts).toContain('CodecTypes');
  });

  it('emits contract with correct coreHash', async () => {
    const contractPath = join(fixturesDir, 'valid-contract.ts');
    const adapterPath = resolve(__dirname, '../../adapter-postgres');

    const contract = await loadContractFromTs(contractPath);
    const packs = loadExtensionPacks(adapterPath, []);

    const result = await emit(contract, {
      outputDir,
      packs,
    });

    expect(result.coreHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('creates output directory if it does not exist', async () => {
    const newOutputDir = join(tmpdir(), `prisma-next-test-new-${Date.now()}`);
    const contractPath = join(fixturesDir, 'valid-contract.ts');
    const adapterPath = resolve(__dirname, '../../adapter-postgres');

    const contract = await loadContractFromTs(contractPath);
    const packs = loadExtensionPacks(adapterPath, []);

    const result = await emit(contract, {
      outputDir: newOutputDir,
      packs,
    });

    mkdirSync(newOutputDir, { recursive: true });

    const contractJsonPath = join(newOutputDir, 'contract.json');
    const contractDtsPath = join(newOutputDir, 'contract.d.ts');

    writeFileSync(contractJsonPath, result.contractJson, 'utf-8');
    writeFileSync(contractDtsPath, result.contractDts, 'utf-8');

    expect(existsSync(contractJsonPath)).toBe(true);
    expect(existsSync(contractDtsPath)).toBe(true);

    if (existsSync(newOutputDir)) {
      rmSync(newOutputDir, { recursive: true, force: true });
    }
  });
});

