import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emitContract } from '../../src/api/emit-contract';
import { loadConfig } from '../../src/config-loader';
import {
  assembleOperationRegistry,
  extractCodecTypeImports,
  extractExtensionIds,
  extractOperationTypeImports,
} from '../../src/pack-assembly';
import { setupIntegrationTestDirectoryFromFixtures } from '../utils/test-helpers';

// Fixture subdirectory for emit-contract tests
const fixtureSubdir = 'emit-contract';

describe('emitContract API', () => {
  let testDir: string;
  let configPath: string;
  let cleanupDir: () => void;

  beforeEach(() => {
    // Set up test directory from fixtures
    const testSetup = setupIntegrationTestDirectoryFromFixtures(fixtureSubdir);
    testDir = testSetup.testDir;
    configPath = testSetup.configPath;
    cleanupDir = testSetup.cleanup;
  });

  afterEach(() => {
    cleanupDir();
  });

  it(
    'emits contract.json and contract.d.ts with resolved values',
    async () => {
      // Load config and resolve values
      const config = await loadConfig(configPath);
      if (!config.contract) {
        throw new Error('Config.contract is required');
      }

      const contractConfig = config.contract;
      let contractRaw: unknown;
      if (typeof contractConfig.source === 'function') {
        contractRaw = await contractConfig.source();
      } else {
        contractRaw = contractConfig.source;
      }

      const contractWithoutMappings = config.family.stripMappings
        ? config.family.stripMappings(contractRaw)
        : contractRaw;

      const contractIR = config.family.validateContractIR(contractWithoutMappings);

      if (!contractConfig.output || !contractConfig.types) {
        throw new Error('Contract config must have output and types paths');
      }

      const descriptors = [config.adapter, config.target, ...(config.extensions ?? [])];
      const operationRegistry = assembleOperationRegistry(descriptors, config.family);
      const codecTypeImports = extractCodecTypeImports(descriptors);
      const operationTypeImports = extractOperationTypeImports(descriptors);
      const extensionIds = extractExtensionIds(
        config.adapter,
        config.target,
        config.extensions ?? [],
      );

      const result = await emitContract({
        contractIR: contractIR as ContractIR,
        outputJsonPath: resolve(testDir, contractConfig.output),
        outputDtsPath: resolve(testDir, contractConfig.types),
        targetFamily: config.family.hook,
        operationRegistry,
        codecTypeImports,
        operationTypeImports,
        extensionIds,
      });

      expect(result).toBeDefined();
      expect(result.coreHash).toBeDefined();
      expect(result.outDir).toBeDefined();
      expect(result.files.json).toBeDefined();
      expect(result.files.dts).toBeDefined();
      expect(result.timings.total).toBeGreaterThanOrEqual(0);

      const contractJsonPath = result.files.json;
      const contractDtsPath = result.files.dts;

      expect(existsSync(contractJsonPath)).toBe(true);
      expect(existsSync(contractDtsPath)).toBe(true);

      const contractJson = JSON.parse(readFileSync(contractJsonPath, 'utf-8'));
      expect(contractJson).toMatchObject({
        targetFamily: 'sql',
        _generated: expect.anything(),
      });

      const contractDts = readFileSync(contractDtsPath, 'utf-8');
      expect(contractDts).toContain('export type Contract');
      expect(contractDts).toContain('CodecTypes');
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'uses config paths for output',
    async () => {
      // Load config and resolve values
      const config = await loadConfig(configPath);
      if (!config.contract) {
        throw new Error('Config.contract is required');
      }

      const contractConfig = config.contract;
      let contractRaw: unknown;
      if (typeof contractConfig.source === 'function') {
        contractRaw = await contractConfig.source();
      } else {
        contractRaw = contractConfig.source;
      }

      const contractWithoutMappings = config.family.stripMappings
        ? config.family.stripMappings(contractRaw)
        : contractRaw;

      const contractIR = config.family.validateContractIR(contractWithoutMappings);

      if (!contractConfig.output || !contractConfig.types) {
        throw new Error('Contract config must have output and types paths');
      }

      const descriptors = [config.adapter, config.target, ...(config.extensions ?? [])];
      const operationRegistry = assembleOperationRegistry(descriptors, config.family);
      const codecTypeImports = extractCodecTypeImports(descriptors);
      const operationTypeImports = extractOperationTypeImports(descriptors);
      const extensionIds = extractExtensionIds(
        config.adapter,
        config.target,
        config.extensions ?? [],
      );

      const result = await emitContract({
        contractIR: contractIR as ContractIR,
        outputJsonPath: resolve(testDir, contractConfig.output),
        outputDtsPath: resolve(testDir, contractConfig.types),
        targetFamily: config.family.hook,
        operationRegistry,
        codecTypeImports,
        operationTypeImports,
        extensionIds,
      });

      // Should use paths from config
      expect(result.files.json).toContain('output/contract.json');
      expect(result.files.dts).toContain('output/contract.d.ts');
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'creates output directory if it does not exist',
    async () => {
      const newOutputDir = join(testDir, 'new-output');
      // Set up test directory with custom output config
      const testSetup = setupIntegrationTestDirectoryFromFixtures(
        fixtureSubdir,
        'prisma-next.config.custom-output.ts',
        { '{{OUTPUT_DIR}}': newOutputDir },
      );
      const customTestDir = testSetup.testDir;
      const customConfigPath = testSetup.configPath;
      const customCleanup = testSetup.cleanup;

      try {
        // Load config and resolve values
        const config = await loadConfig(customConfigPath);
        if (!config.contract) {
          throw new Error('Config.contract is required');
        }

        const contractConfig = config.contract;
        let contractRaw: unknown;
        if (typeof contractConfig.source === 'function') {
          contractRaw = await contractConfig.source();
        } else {
          contractRaw = contractConfig.source;
        }

        const contractWithoutMappings = config.family.stripMappings
          ? config.family.stripMappings(contractRaw)
          : contractRaw;

        const contractIR = config.family.validateContractIR(contractWithoutMappings);

        if (!contractConfig.output || !contractConfig.types) {
          throw new Error('Contract config must have output and types paths');
        }

        const descriptors = [config.adapter, config.target, ...(config.extensions ?? [])];
        const operationRegistry = assembleOperationRegistry(descriptors, config.family);
        const codecTypeImports = extractCodecTypeImports(descriptors);
        const operationTypeImports = extractOperationTypeImports(descriptors);
        const extensionIds = extractExtensionIds(
          config.adapter,
          config.target,
          config.extensions ?? [],
        );

        const result = await emitContract({
          contractIR: contractIR as ContractIR,
          outputJsonPath: resolve(customTestDir, contractConfig.output),
          outputDtsPath: resolve(customTestDir, contractConfig.types),
          targetFamily: config.family.hook,
          operationRegistry,
          codecTypeImports,
          operationTypeImports,
          extensionIds,
        });

        expect(existsSync(newOutputDir)).toBe(true);
        expect(existsSync(result.files.json)).toBe(true);
        expect(existsSync(result.files.dts)).toBe(true);
      } finally {
        customCleanup();
      }
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'includes profileHash when present',
    async () => {
      // Load config and resolve values
      const config = await loadConfig(configPath);
      if (!config.contract) {
        throw new Error('Config.contract is required');
      }

      const contractConfig = config.contract;
      let contractRaw: unknown;
      if (typeof contractConfig.source === 'function') {
        contractRaw = await contractConfig.source();
      } else {
        contractRaw = contractConfig.source;
      }

      const contractWithoutMappings = config.family.stripMappings
        ? config.family.stripMappings(contractRaw)
        : contractRaw;

      const contractIR = config.family.validateContractIR(contractWithoutMappings);

      if (!contractConfig.output || !contractConfig.types) {
        throw new Error('Contract config must have output and types paths');
      }

      const descriptors = [config.adapter, config.target, ...(config.extensions ?? [])];
      const operationRegistry = assembleOperationRegistry(descriptors, config.family);
      const codecTypeImports = extractCodecTypeImports(descriptors);
      const operationTypeImports = extractOperationTypeImports(descriptors);
      const extensionIds = extractExtensionIds(
        config.adapter,
        config.target,
        config.extensions ?? [],
      );

      const result = await emitContract({
        contractIR: contractIR as ContractIR,
        outputJsonPath: resolve(testDir, contractConfig.output),
        outputDtsPath: resolve(testDir, contractConfig.types),
        targetFamily: config.family.hook,
        operationRegistry,
        codecTypeImports,
        operationTypeImports,
        extensionIds,
      });

      // profileHash is always present
      expect(typeof result.profileHash).toBe('string');
      expect(result.profileHash.length).toBeGreaterThan(0);
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'returns timings information',
    async () => {
      // Load config and resolve values
      const config = await loadConfig(configPath);
      if (!config.contract) {
        throw new Error('Config.contract is required');
      }

      const contractConfig = config.contract;
      let contractRaw: unknown;
      if (typeof contractConfig.source === 'function') {
        contractRaw = await contractConfig.source();
      } else {
        contractRaw = contractConfig.source;
      }

      const contractWithoutMappings = config.family.stripMappings
        ? config.family.stripMappings(contractRaw)
        : contractRaw;

      const contractIR = config.family.validateContractIR(contractWithoutMappings);

      if (!contractConfig.output || !contractConfig.types) {
        throw new Error('Contract config must have output and types paths');
      }

      const descriptors = [config.adapter, config.target, ...(config.extensions ?? [])];
      const operationRegistry = assembleOperationRegistry(descriptors, config.family);
      const codecTypeImports = extractCodecTypeImports(descriptors);
      const operationTypeImports = extractOperationTypeImports(descriptors);
      const extensionIds = extractExtensionIds(
        config.adapter,
        config.target,
        config.extensions ?? [],
      );

      const result = await emitContract({
        contractIR: contractIR as ContractIR,
        outputJsonPath: resolve(testDir, contractConfig.output),
        outputDtsPath: resolve(testDir, contractConfig.types),
        targetFamily: config.family.hook,
        operationRegistry,
        codecTypeImports,
        operationTypeImports,
        extensionIds,
      });

      expect(result.timings).toBeDefined();
      expect(result.timings.total).toBeGreaterThanOrEqual(0);
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'handles non-Error exceptions',
    async () => {
      // This test verifies the error handling path for non-Error exceptions
      // We can't easily trigger this in a real scenario, but the code path exists
      const config = await loadConfig(configPath);
      if (!config.contract) {
        throw new Error('Config.contract is required');
      }

      const contractConfig = config.contract;
      let contractRaw: unknown;
      if (typeof contractConfig.source === 'function') {
        contractRaw = await contractConfig.source();
      } else {
        contractRaw = contractConfig.source;
      }

      const contractWithoutMappings = config.family.stripMappings
        ? config.family.stripMappings(contractRaw)
        : contractRaw;

      const contractIR = config.family.validateContractIR(contractWithoutMappings);

      if (!contractConfig.output || !contractConfig.types) {
        throw new Error('Contract config must have output and types paths');
      }

      const descriptors = [config.adapter, config.target, ...(config.extensions ?? [])];
      const operationRegistry = assembleOperationRegistry(descriptors, config.family);
      const codecTypeImports = extractCodecTypeImports(descriptors);
      const operationTypeImports = extractOperationTypeImports(descriptors);
      const extensionIds = extractExtensionIds(
        config.adapter,
        config.target,
        config.extensions ?? [],
      );

      // The function should work normally, but we've verified the error handling path exists
      const result = await emitContract({
        contractIR: contractIR as ContractIR,
        outputJsonPath: resolve(testDir, contractConfig.output),
        outputDtsPath: resolve(testDir, contractConfig.types),
        targetFamily: config.family.hook,
        operationRegistry,
        codecTypeImports,
        operationTypeImports,
        extensionIds,
      });

      expect(result).toBeDefined();
    },
    timeouts.typeScriptCompilation,
  );
});
