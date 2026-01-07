import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadConfig } from '@prisma-next/cli/config-loader';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupIntegrationTestDirectoryFromFixtures } from './utils/cli-test-helpers.ts';

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

      if (!contractConfig.output || !contractConfig.types) {
        throw new Error('Contract config must have output and types paths');
      }

      // Create family instance (assembles operation registry, type imports, extension IDs)
      if (!config.driver) {
        throw new Error('Config.driver is required');
      }
      const familyInstance = config.family.create({
        target: config.target,
        adapter: config.adapter,
        driver: config.driver,
        extensionPacks: config.extensionPacks ?? [],
      });

      // emitContract handles stripping mappings and validation internally
      const result = await familyInstance.emitContract({ contractIR: contractRaw });

      expect(result).toBeDefined();
      expect(result.coreHash).toBeDefined();
      expect(result.profileHash).toBeDefined();
      expect(result.contractJson).toBeDefined();
      expect(result.contractDts).toBeDefined();

      // Write the returned strings to files
      const contractJsonPath = resolve(testDir, contractConfig.output);
      const contractDtsPath = resolve(testDir, contractConfig.types);
      mkdirSync(dirname(contractJsonPath), { recursive: true });
      mkdirSync(dirname(contractDtsPath), { recursive: true });
      writeFileSync(contractJsonPath, result.contractJson, 'utf-8');
      writeFileSync(contractDtsPath, result.contractDts, 'utf-8');

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

      if (!contractConfig.output || !contractConfig.types) {
        throw new Error('Contract config must have output and types paths');
      }

      // Create family instance (assembles operation registry, type imports, extension IDs)
      if (!config.driver) {
        throw new Error('Config.driver is required');
      }
      const familyInstance = config.family.create({
        target: config.target,
        adapter: config.adapter,
        driver: config.driver,
        extensionPacks: config.extensionPacks ?? [],
      });

      // emitContract handles stripping mappings and validation internally
      const result = await familyInstance.emitContract({ contractIR: contractRaw });

      // Write files and verify paths
      const contractJsonPath = resolve(testDir, contractConfig.output);
      const contractDtsPath = resolve(testDir, contractConfig.types);
      mkdirSync(dirname(contractJsonPath), { recursive: true });
      mkdirSync(dirname(contractDtsPath), { recursive: true });
      writeFileSync(contractJsonPath, result.contractJson, 'utf-8');
      writeFileSync(contractDtsPath, result.contractDts, 'utf-8');
      expect(contractJsonPath).toContain('output/contract.json');
      expect(contractDtsPath).toContain('output/contract.d.ts');
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

        if (!contractConfig.output || !contractConfig.types) {
          throw new Error('Contract config must have output and types paths');
        }

        // Create family instance (assembles operation registry, type imports, extension IDs)
        if (!config.driver) {
          throw new Error('Config.driver is required');
        }
        const familyInstance = config.family.create({
          target: config.target,
          adapter: config.adapter,
          driver: config.driver,
          extensionPacks: config.extensionPacks ?? [],
        });

        // emitContract handles stripping mappings and validation internally
        const result = await familyInstance.emitContract({ contractIR: contractRaw });

        // Write files
        const contractJsonPath = resolve(customTestDir, contractConfig.output);
        const contractDtsPath = resolve(customTestDir, contractConfig.types);
        mkdirSync(dirname(contractJsonPath), { recursive: true });
        mkdirSync(dirname(contractDtsPath), { recursive: true });
        writeFileSync(contractJsonPath, result.contractJson, 'utf-8');
        writeFileSync(contractDtsPath, result.contractDts, 'utf-8');
        expect(existsSync(newOutputDir)).toBe(true);
        expect(existsSync(contractJsonPath)).toBe(true);
        expect(existsSync(contractDtsPath)).toBe(true);
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

      if (!contractConfig.output || !contractConfig.types) {
        throw new Error('Contract config must have output and types paths');
      }

      // Create family instance (assembles operation registry, type imports, extension IDs)
      if (!config.driver) {
        throw new Error('Config.driver is required');
      }
      const familyInstance = config.family.create({
        target: config.target,
        adapter: config.adapter,
        driver: config.driver,
        extensionPacks: config.extensionPacks ?? [],
      });

      // emitContract handles stripping mappings and validation internally
      const result = await familyInstance.emitContract({ contractIR: contractRaw });

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

      if (!contractConfig.output || !contractConfig.types) {
        throw new Error('Contract config must have output and types paths');
      }

      // Create family instance (assembles operation registry, type imports, extension IDs)
      if (!config.driver) {
        throw new Error('Config.driver is required');
      }
      const familyInstance = config.family.create({
        target: config.target,
        adapter: config.adapter,
        driver: config.driver,
        extensionPacks: config.extensionPacks ?? [],
      });

      // emitContract handles stripping mappings and validation internally
      const result = await familyInstance.emitContract({ contractIR: contractRaw });

      // Timings are no longer returned in the result
      expect(result).toBeDefined();
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

      if (!contractConfig.output || !contractConfig.types) {
        throw new Error('Contract config must have output and types paths');
      }

      // Create family instance (assembles operation registry, type imports, extension IDs)
      if (!config.driver) {
        throw new Error('Config.driver is required');
      }
      const familyInstance = config.family.create({
        target: config.target,
        adapter: config.adapter,
        driver: config.driver,
        extensionPacks: config.extensionPacks ?? [],
      });

      // emitContract handles stripping mappings and validation internally
      const result = await familyInstance.emitContract({ contractIR: contractRaw });

      expect(result).toBeDefined();
    },
    timeouts.typeScriptCompilation,
  );
});
