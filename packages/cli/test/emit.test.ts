import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit, loadExtensionPacks } from '@prisma-next/emitter';
import { sqlTargetFamilyHook } from '@prisma-next/sql-target';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadContractFromTs } from '../src/load-ts-contract';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

describe('emit command functionality', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = join(
      tmpdir(),
      `prisma-next-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
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

    const result = await emit(
      contract,
      {
        outputDir,
        packs,
      },
      sqlTargetFamilyHook,
    );

    const contractJsonPath = join(outputDir, 'contract.json');
    const contractDtsPath = join(outputDir, 'contract.d.ts');

    writeFileSync(contractJsonPath, result.contractJson, 'utf-8');
    writeFileSync(contractDtsPath, result.contractDts, 'utf-8');

    expect(existsSync(contractJsonPath)).toBe(true);
    expect(existsSync(contractDtsPath)).toBe(true);

    const contractJson = JSON.parse(readFileSync(contractJsonPath, 'utf-8')) as Record<
      string,
      unknown
    >;
    expect(contractJson['targetFamily']).toBe('sql');
    expect(contractJson['target']).toBe('postgres');
    const storage = contractJson['storage'] as Record<string, unknown> | undefined;
    const tables = storage?.['tables'] as Record<string, unknown> | undefined;
    expect(tables?.['user']).toBeDefined();

    const contractDts = readFileSync(contractDtsPath, 'utf-8');
    expect(contractDts).toContain('export type Contract');
    expect(contractDts).toContain('CodecTypes');
  });

  it('emits contract with correct coreHash', async () => {
    const contractPath = join(fixturesDir, 'valid-contract.ts');
    const adapterPath = resolve(__dirname, '../../adapter-postgres');

    const contract = await loadContractFromTs(contractPath);
    const packs = loadExtensionPacks(adapterPath, []);

    const result = await emit(
      contract,
      {
        outputDir,
        packs,
      },
      sqlTargetFamilyHook,
    );

    expect(result.coreHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('creates output directory if it does not exist', async () => {
    const newOutputDir = join(tmpdir(), `prisma-next-test-new-${Date.now()}`);
    const contractPath = join(fixturesDir, 'valid-contract.ts');
    const adapterPath = resolve(__dirname, '../../adapter-postgres');

    const contract = await loadContractFromTs(contractPath);
    const packs = loadExtensionPacks(adapterPath, []);

    const result = await emit(
      contract,
      {
        outputDir: newOutputDir,
        packs,
      },
      sqlTargetFamilyHook,
    );

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
