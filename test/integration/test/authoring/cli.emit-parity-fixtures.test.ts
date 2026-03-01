import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContractEmitCommand } from '@prisma-next/cli/commands/contract-emit';
import { loadConfig } from '@prisma-next/cli/config-loader';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeCommand, setupCommandMocks } from '../utils/cli-test-helpers';
import {
  listAuthoringParityFixtureCases,
  resolveAuthoringDiagnosticsFixtureSchemaPath,
  setupIntegrationTestDirectoryForAuthoringParityCase,
} from './authoring-parity-test-helpers';

const writeExpected = process.env['UPDATE_AUTHORING_PARITY_EXPECTED'] === '1';

function parseContractJson(contractJson: string): Record<string, unknown> {
  return JSON.parse(contractJson) as Record<string, unknown>;
}

function assertCanonicalProvenanceInvariants(contractJson: Record<string, unknown>): void {
  expect(contractJson).not.toHaveProperty('sources');
  const meta = contractJson['meta'];
  if (typeof meta === 'object' && meta !== null) {
    expect(meta).not.toHaveProperty('source');
    expect(meta).not.toHaveProperty('sourceId');
    expect(meta).not.toHaveProperty('schemaPath');
  }
}

const parityCases = listAuthoringParityFixtureCases();

describe('emit parity fixtures', () => {
  it('discovers at least one parity fixture case', () => {
    expect(parityCases.length).toBeGreaterThan(0);
  });

  for (const fixtureCase of parityCases) {
    it(
      `matches ts and psl emission for ${fixtureCase.caseName}`,
      { timeout: timeouts.typeScriptCompilation },
      async () => {
        const testSetup = setupIntegrationTestDirectoryForAuthoringParityCase(fixtureCase.caseName);

        try {
          const tsConfig = await loadConfig(testSetup.tsConfigPath);
          const pslConfig = await loadConfig(testSetup.pslConfigPath);

          if (!tsConfig.contract || !pslConfig.contract || !tsConfig.driver || !pslConfig.driver) {
            throw new Error('Fixture parity tests require contract + driver in both configs');
          }

          const originalCwd = process.cwd();
          let tsProviderResult: Awaited<ReturnType<typeof tsConfig.contract.source>>;
          let pslProviderResult: Awaited<ReturnType<typeof pslConfig.contract.source>>;
          try {
            process.chdir(testSetup.testDir);
            tsProviderResult = await tsConfig.contract.source();
            pslProviderResult = await pslConfig.contract.source();
          } finally {
            process.chdir(originalCwd);
          }

          if (!tsProviderResult.ok) {
            throw new Error(`TS provider failed: ${tsProviderResult.failure.summary}`);
          }
          if (!pslProviderResult.ok) {
            throw new Error(`PSL provider failed: ${pslProviderResult.failure.summary}`);
          }

          const familyInstance = tsConfig.family.create({
            target: tsConfig.target,
            adapter: tsConfig.adapter,
            driver: tsConfig.driver,
            extensionPacks: tsConfig.extensionPacks ?? [],
          });

          const normalizedTs = familyInstance.validateContractIR(tsProviderResult.value);
          const normalizedPsl = familyInstance.validateContractIR(pslProviderResult.value);
          expect(normalizedTs).toEqual(normalizedPsl);

          const tsEmitFirst = await familyInstance.emitContract({ contractIR: normalizedTs });
          const tsEmitSecond = await familyInstance.emitContract({ contractIR: normalizedTs });
          const pslEmitFirst = await familyInstance.emitContract({ contractIR: normalizedPsl });
          const pslEmitSecond = await familyInstance.emitContract({ contractIR: normalizedPsl });

          expect(tsEmitFirst.contractJson).toBe(tsEmitSecond.contractJson);
          expect(pslEmitFirst.contractJson).toBe(pslEmitSecond.contractJson);
          expect(tsEmitFirst.storageHash).toBe(tsEmitSecond.storageHash);
          expect(pslEmitFirst.storageHash).toBe(pslEmitSecond.storageHash);
          expect(tsEmitFirst.profileHash).toBe(tsEmitSecond.profileHash);
          expect(pslEmitFirst.profileHash).toBe(pslEmitSecond.profileHash);

          const tsContractJson = parseContractJson(tsEmitFirst.contractJson);
          const pslContractJson = parseContractJson(pslEmitFirst.contractJson);

          expect(tsContractJson).toEqual(pslContractJson);
          assertCanonicalProvenanceInvariants(tsContractJson);

          expect(tsEmitFirst.storageHash).toMatch(/^sha256:[a-f0-9]{64}$/);
          expect(tsEmitFirst.profileHash).toMatch(/^sha256:[a-f0-9]{64}$/);
          expect(pslEmitFirst.storageHash).toBe(tsEmitFirst.storageHash);
          expect(pslEmitFirst.profileHash).toBe(tsEmitFirst.profileHash);

          const tsExecutionHash = tsContractJson['executionHash'];
          const pslExecutionHash = pslContractJson['executionHash'];
          expect(pslExecutionHash).toBe(tsExecutionHash);
          if (typeof tsExecutionHash === 'string') {
            expect(tsExecutionHash).toMatch(/^sha256:[a-f0-9]{64}$/);
          }

          if (writeExpected) {
            writeFileSync(
              fixtureCase.expectedContractPath,
              `${tsEmitFirst.contractJson}\n`,
              'utf-8',
            );
          }

          const expectedContractJson = parseContractJson(
            readFileSync(fixtureCase.expectedContractPath, 'utf-8'),
          );
          expect(tsContractJson).toEqual(expectedContractJson);
        } finally {
          testSetup.cleanup();
        }
      },
    );
  }
});

describe('emit parity fixture diagnostics', () => {
  let consoleErrors: string[] = [];
  let cleanupMocks: () => void;

  beforeEach(() => {
    const mocks = setupCommandMocks();
    consoleErrors = mocks.consoleErrors;
    cleanupMocks = mocks.cleanup;
  });

  afterEach(() => {
    cleanupMocks();
  });

  it(
    'reports actionable psl diagnostics from fixtureized invalid schema',
    { timeout: timeouts.typeScriptCompilation },
    async () => {
      const testSetup = setupIntegrationTestDirectoryForAuthoringParityCase('core-surface');
      const invalidSchemaPath =
        resolveAuthoringDiagnosticsFixtureSchemaPath('unsupported-list-field');
      const command = createContractEmitCommand();

      try {
        writeFileSync(
          join(testSetup.testDir, 'schema.prisma'),
          readFileSync(invalidSchemaPath, 'utf-8'),
          'utf-8',
        );

        const pslConfig = await loadConfig(testSetup.pslConfigPath);
        if (!pslConfig.contract) {
          throw new Error('PSL config contract is required for diagnostics fixture test');
        }

        const originalCwd = process.cwd();
        let sourceResult: Awaited<ReturnType<typeof pslConfig.contract.source>>;
        try {
          process.chdir(testSetup.testDir);
          sourceResult = await pslConfig.contract.source();
        } finally {
          process.chdir(originalCwd);
        }
        expect(sourceResult.ok).toBe(false);
        if (sourceResult.ok) {
          throw new Error('Expected PSL source provider to fail for unsupported list field');
        }

        expect(sourceResult.failure.summary).toBe('PSL to SQL Contract IR normalization failed');
        expect(sourceResult.failure.diagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: 'PSL_UNSUPPORTED_FIELD_LIST',
              sourceId: './schema.prisma',
              span: expect.objectContaining({
                start: expect.objectContaining({ line: 3, column: expect.any(Number) }),
              }),
            }),
          ]),
        );

        const commandCwd = process.cwd();
        try {
          process.chdir(testSetup.testDir);
          await expect(
            executeCommand(command, ['--config', 'prisma-next.config.parity-psl.ts']),
          ).rejects.toThrow();
        } finally {
          process.chdir(commandCwd);
        }

        const errorOutput = consoleErrors.join('\n');
        expect(errorOutput).toContain('PSL to SQL Contract IR normalization failed');
        expect(errorOutput).toContain('PSL_UNSUPPORTED_FIELD_LIST');
        expect(errorOutput).toMatch(/schema\.prisma:\d+:\d+/);
      } finally {
        testSetup.cleanup();
      }
    },
  );
});
