import { readFileSync, writeFileSync } from 'node:fs';
import { createContractEmitCommand } from '@prisma-next/cli/commands/contract-emit';
import { loadConfig } from '@prisma-next/cli/config-loader';
import { timeouts } from '@prisma-next/test-utils';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeCommand, setupCommandMocks } from '../utils/cli-test-helpers';
import {
  listAuthoringDiagnosticsFixtureCases,
  listAuthoringParityFixtureCases,
  setupIntegrationTestDirectoryForAuthoringParityCase,
} from './authoring-parity-test-helpers';

const writeExpected = process.env['UPDATE_AUTHORING_PARITY_EXPECTED'] === '1';

function parseContractJson(contractJson: string): Record<string, unknown> {
  return JSON.parse(contractJson) as Record<string, unknown>;
}

function assertContractJsonOmitsSourceProvenance(contractJson: Record<string, unknown>): void {
  expect(contractJson).not.toHaveProperty('sources');
  const meta = contractJson['meta'];
  if (typeof meta === 'object' && meta !== null) {
    expect(meta).not.toHaveProperty('source');
    expect(meta).not.toHaveProperty('sourceId');
    expect(meta).not.toHaveProperty('schemaPath');
  }
}

interface ExpectedDiagnosticsFixture {
  readonly failureSummary: string;
  readonly diagnostics: readonly {
    readonly code: string;
    readonly sourceId: string;
    readonly startLine: number;
  }[];
}

function parseExpectedDiagnosticsFixture(
  expectedDiagnosticsJson: string,
): ExpectedDiagnosticsFixture {
  return JSON.parse(expectedDiagnosticsJson) as ExpectedDiagnosticsFixture;
}

const parityCases = listAuthoringParityFixtureCases();
const diagnosticsCases = listAuthoringDiagnosticsFixtureCases();
const coreSurfaceCase = parityCases.find((fixtureCase) => fixtureCase.caseName === 'core-surface');

if (!coreSurfaceCase) {
  throw new Error('Required parity fixture case "core-surface" not found');
}

describe('emit parity fixtures', () => {
  it('discovers at least one parity fixture case', () => {
    expect(parityCases.length).toBeGreaterThan(0);
  });

  for (const fixtureCase of parityCases) {
    it(
      `matches ts and psl emission for ${fixtureCase.caseName}`,
      { timeout: timeouts.typeScriptCompilation },
      async () => {
        const testSetup = setupIntegrationTestDirectoryForAuthoringParityCase(fixtureCase);

        try {
          const tsConfig = await loadConfig(testSetup.tsConfigPath);
          const pslConfig = await loadConfig(testSetup.pslConfigPath);

          if (!tsConfig.contract || !pslConfig.contract || !tsConfig.driver || !pslConfig.driver) {
            throw new Error('Fixture parity tests require contract + driver in both configs');
          }

          const originalCwd = process.cwd();
          let tsProviderResultFirst: Awaited<ReturnType<typeof tsConfig.contract.source>>;
          let tsProviderResultSecond: Awaited<ReturnType<typeof tsConfig.contract.source>>;
          let pslProviderResultFirst: Awaited<ReturnType<typeof pslConfig.contract.source>>;
          let pslProviderResultSecond: Awaited<ReturnType<typeof pslConfig.contract.source>>;
          try {
            process.chdir(testSetup.testDir);
            tsProviderResultFirst = await tsConfig.contract.source();
            tsProviderResultSecond = await tsConfig.contract.source();
            pslProviderResultFirst = await pslConfig.contract.source();
            pslProviderResultSecond = await pslConfig.contract.source();
          } finally {
            process.chdir(originalCwd);
          }

          expect(tsProviderResultSecond).toEqual(tsProviderResultFirst);
          expect(pslProviderResultSecond).toEqual(pslProviderResultFirst);

          if (!tsProviderResultFirst.ok) {
            throw new Error(`TS provider failed: ${tsProviderResultFirst.failure.summary}`);
          }
          if (!pslProviderResultFirst.ok) {
            throw new Error(`PSL provider failed: ${pslProviderResultFirst.failure.summary}`);
          }

          const familyInstance = tsConfig.family.create({
            target: tsConfig.target,
            adapter: tsConfig.adapter,
            driver: tsConfig.driver,
            extensionPacks: tsConfig.extensionPacks ?? [],
          });

          const normalizedTs = familyInstance.validateContractIR(tsProviderResultFirst.value);
          const normalizedPsl = familyInstance.validateContractIR(pslProviderResultFirst.value);
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
          assertContractJsonOmitsSourceProvenance(tsContractJson);

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

  for (const diagnosticsCase of diagnosticsCases) {
    it(
      `reports actionable psl diagnostics for ${diagnosticsCase.caseName}`,
      { timeout: timeouts.typeScriptCompilation },
      async () => {
        const testSetup = setupIntegrationTestDirectoryForAuthoringParityCase(coreSurfaceCase);
        const command = createContractEmitCommand();
        const expectedFixture = parseExpectedDiagnosticsFixture(
          readFileSync(diagnosticsCase.expectedDiagnosticsPath, 'utf-8'),
        );

        try {
          writeFileSync(
            join(testSetup.testDir, 'schema.prisma'),
            readFileSync(diagnosticsCase.schemaPath, 'utf-8'),
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
            throw new Error(`Expected PSL source provider to fail for ${diagnosticsCase.caseName}`);
          }

          expect(sourceResult.failure.summary).toBe(expectedFixture.failureSummary);
          expect(sourceResult.failure.diagnostics).toEqual(
            expect.arrayContaining(
              expectedFixture.diagnostics.map((diagnostic) =>
                expect.objectContaining({
                  code: diagnostic.code,
                  sourceId: diagnostic.sourceId,
                  span: expect.objectContaining({
                    start: expect.objectContaining({
                      line: diagnostic.startLine,
                      column: expect.any(Number),
                    }),
                  }),
                }),
              ),
            ),
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
          expect(errorOutput).toContain(expectedFixture.failureSummary);
          for (const diagnostic of expectedFixture.diagnostics) {
            expect(errorOutput).toContain(diagnostic.code);
          }
          expect(errorOutput).toMatch(/schema\.prisma:\d+:\d+/);
        } finally {
          testSetup.cleanup();
        }
      },
    );
  }
});
