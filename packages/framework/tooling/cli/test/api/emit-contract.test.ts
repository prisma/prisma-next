import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, '../../../../../');
const fixturesDir = join(__dirname, '../fixtures');

function createConfigFileContent(includeContract = true, outputOverride?: string): string {
  // Use absolute paths to dist files to avoid import resolution issues in temp directories
  const adapterPath = resolve(
    workspaceRoot,
    'packages/targets/postgres-adapter/dist/exports/cli.js',
  );
  const targetPath = resolve(workspaceRoot, 'packages/targets/postgres/dist/exports/cli.js');
  const familyPath = resolve(workspaceRoot, 'packages/sql/tooling/cli/dist/exports/cli.js');
  const configTypesPath = resolve(
    workspaceRoot,
    'packages/framework/tooling/cli/dist/config-types.js',
  );
  const contractPath = resolve(fixturesDir, 'valid-contract.ts');

  const contractImport = includeContract ? `import { contract } from '${contractPath}';` : '';
  const contractField = includeContract
    ? `  contract: {
    source: contract,
    output: '${outputOverride ?? 'output/contract.json'}',
    types: '${outputOverride ? outputOverride.replace('.json', '.d.ts') : 'output/contract.d.ts'}',
  },`
    : '';

  return `import { defineConfig } from '${configTypesPath}';
import postgresAdapter from '${adapterPath}';
import postgres from '${targetPath}';
import sql from '${familyPath}';
${contractImport}

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
${contractField}
});
`;
}

describe('emitContract API', () => {
  let testDir: string;
  let outputDir: string;
  let configPath: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `prisma-next-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
    outputDir = join(testDir, 'output');
    configPath = join(testDir, 'prisma-next.config.ts');

    // Create default config file with absolute paths
    writeFileSync(configPath, createConfigFileContent(), 'utf-8');
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
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
        contractIR: contractIR as typeof contractIR,
        outputJsonPath: resolve(contractConfig.output),
        outputDtsPath: resolve(contractConfig.types),
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
        contractIR: contractIR as typeof contractIR,
        outputJsonPath: resolve(contractConfig.output),
        outputDtsPath: resolve(contractConfig.types),
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
      const customConfigPath = join(testDir, 'custom-config.ts');
      writeFileSync(
        customConfigPath,
        createConfigFileContent(true, join(newOutputDir, 'contract.json')),
        'utf-8',
      );

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
        contractIR: contractIR as typeof contractIR,
        outputJsonPath: resolve(contractConfig.output),
        outputDtsPath: resolve(contractConfig.types),
        targetFamily: config.family.hook,
        operationRegistry,
        codecTypeImports,
        operationTypeImports,
        extensionIds,
      });

      expect(existsSync(newOutputDir)).toBe(true);
      expect(existsSync(result.files.json)).toBe(true);
      expect(existsSync(result.files.dts)).toBe(true);
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
        contractIR: contractIR as typeof contractIR,
        outputJsonPath: resolve(contractConfig.output),
        outputDtsPath: resolve(contractConfig.types),
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
        contractIR: contractIR as typeof contractIR,
        outputJsonPath: resolve(contractConfig.output),
        outputDtsPath: resolve(contractConfig.types),
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
});

