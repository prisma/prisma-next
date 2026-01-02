import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContractFromTs } from '@prisma-next/cli';
import { emit } from '@prisma-next/emitter';
import {
  assembleOperationRegistry,
  convertOperationManifest,
  extractCodecTypeImports,
  extractExtensionIds,
  extractOperationTypeImports,
} from '@prisma-next/family-sql/test-utils';
import { sqlTargetFamilyHook } from '@prisma-next/sql-contract-emitter';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getSqlDescriptorBundle } from '../utils/framework-components';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '../../../packages/1-framework/3-tooling/cli/test/fixtures');

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

  const buildEmitterArtifacts = () => {
    const { adapter, target, extensions, descriptors } = getSqlDescriptorBundle();
    return {
      operationRegistry: assembleOperationRegistry(descriptors, convertOperationManifest),
      codecTypeImports: extractCodecTypeImports(descriptors),
      operationTypeImports: extractOperationTypeImports(descriptors),
      extensionIds: extractExtensionIds(adapter, target, extensions),
    };
  };

  it(
    'loads TS contract and emits contract.json and contract.d.ts',
    async () => {
      const contractPath = join(fixturesDir, 'valid-contract.ts');
      const contract = await loadContractFromTs(contractPath);
      const { operationRegistry, codecTypeImports, operationTypeImports, extensionIds } =
        buildEmitterArtifacts();

      const result = await emit(
        contract,
        {
          outputDir,
          operationRegistry,
          codecTypeImports,
          operationTypeImports,
          extensionIds,
        },
        sqlTargetFamilyHook,
      );

      const contractJsonPath = join(outputDir, 'contract.json');
      const contractDtsPath = join(outputDir, 'contract.d.ts');

      writeFileSync(contractJsonPath, result.contractJson, 'utf-8');
      writeFileSync(contractDtsPath, result.contractDts, 'utf-8');

      expect(existsSync(contractJsonPath)).toBe(true);
      expect(existsSync(contractDtsPath)).toBe(true);

      const contractJson = JSON.parse(readFileSync(contractJsonPath, 'utf-8'));
      expect(contractJson).toMatchObject({
        targetFamily: 'sql',
        target: 'postgres',
        storage: {
          tables: {
            user: expect.anything(),
          },
        },
      });

      const contractDts = readFileSync(contractDtsPath, 'utf-8');
      expect(contractDts).toContain('export type Contract');
      expect(contractDts).toContain('CodecTypes');
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'emits contract with correct coreHash',
    async () => {
      const contractPath = join(fixturesDir, 'valid-contract.ts');
      const contract = await loadContractFromTs(contractPath);
      const { operationRegistry, codecTypeImports, operationTypeImports, extensionIds } =
        buildEmitterArtifacts();

      const result = await emit(
        contract,
        {
          outputDir,
          operationRegistry,
          codecTypeImports,
          operationTypeImports,
          extensionIds,
        },
        sqlTargetFamilyHook,
      );

      expect(result.coreHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'creates output directory if it does not exist',
    async () => {
      const newOutputDir = join(tmpdir(), `prisma-next-test-new-${Date.now()}`);
      const contractPath = join(fixturesDir, 'valid-contract.ts');
      const contract = await loadContractFromTs(contractPath);
      const { operationRegistry, codecTypeImports, operationTypeImports, extensionIds } =
        buildEmitterArtifacts();

      const result = await emit(
        contract,
        {
          outputDir: newOutputDir,
          operationRegistry,
          codecTypeImports,
          operationTypeImports,
          extensionIds,
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
    },
    timeouts.typeScriptCompilation,
  );
});
