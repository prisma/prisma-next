import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { timeouts } from '@prisma-next/test-utils';
import { createServer, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  fixtureAppDir,
  setupTestDirectoryFromFixtures,
  withTempDir,
} from './utils/cli-test-helpers';
import { replaceInFileOrThrow } from './utils/contract-fixture-editing';

const tsFixtureSubdir = 'vite-plugin';
const pslFixtureSubdir = 'vite-plugin-psl';

async function waitForFileChange(
  filePath: string,
  originalMtime: number | null,
  timeoutMs: number,
): Promise<boolean> {
  const startTime = Date.now();
  const pollIntervalMs = 50;

  while (Date.now() - startTime < timeoutMs) {
    if (existsSync(filePath)) {
      const stats = await import('node:fs/promises').then((fs) => fs.stat(filePath));
      const currentMtime = stats.mtimeMs;
      if (originalMtime === null || currentMtime > originalMtime) {
        return true;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return false;
}

async function readJsonFileWhenReady(filePath: string, timeoutMs: number): Promise<string> {
  const startTime = Date.now();
  const pollIntervalMs = 50;
  let lastError: unknown;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const contents = readFileSync(filePath, 'utf-8');
      JSON.parse(contents);
      return contents;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Timed out waiting for valid JSON in ${filePath}`);
}

function copyFixtureFiles(
  testDir: string,
  fixtureSubdir: string,
  fileNames: readonly string[],
): void {
  for (const fileName of fileNames) {
    copyFileSync(join(fixtureAppDir, 'fixtures', fixtureSubdir, fileName), join(testDir, fileName));
  }
}

withTempDir(({ createTempDir }) => {
  describe('Vite plugin HMR (e2e)', () => {
    let server: ViteDevServer | null = null;

    afterEach(async () => {
      if (server) {
        await server.close();
        server = null;
      }
    });

    it(
      're-emits contract when contract.ts is modified',
      async () => {
        const testSetup = setupTestDirectoryFromFixtures(createTempDir, tsFixtureSubdir);
        const testDir = testSetup.testDir;
        const outputDir = testSetup.outputDir;
        const contractPath = testSetup.contractPath;

        copyFixtureFiles(testDir, tsFixtureSubdir, ['vite.config.ts']);

        const contractJsonPath = join(outputDir, 'contract.json');

        server = await createServer({
          root: testDir,
          logLevel: 'silent',
          server: {
            middlewareMode: true,
          },
        });

        const initialEmitSuccess = await waitForFileChange(
          contractJsonPath,
          null,
          timeouts.typeScriptCompilation,
        );
        expect(initialEmitSuccess).toBe(true);

        const initialContract = JSON.parse(
          await readJsonFileWhenReady(contractJsonPath, timeouts.typeScriptCompilation),
        );
        expect(initialContract.storage).toMatchObject({
          tables: {
            user: {
              columns: {
                email: expect.anything(),
              },
            },
          },
        });

        const { stat } = await import('node:fs/promises');
        const initialStats = await stat(contractJsonPath);
        const initialMtime = initialStats.mtimeMs;

        await new Promise((resolve) => setTimeout(resolve, 100));

        replaceInFileOrThrow(
          contractPath,
          '        email: field.column(textColumn),\n',
          '        email: field.column(textColumn),\n        name: field.column(textColumn).optional(),\n',
        );

        const contractModules = server.moduleGraph.getModulesByFile(contractPath);
        if (contractModules) {
          for (const module of contractModules) {
            server.moduleGraph.invalidateModule(module);
          }
        }
        server.watcher.emit('change', contractPath);

        const reEmitSuccess = await waitForFileChange(
          contractJsonPath,
          initialMtime,
          timeouts.typeScriptCompilation,
        );
        expect(reEmitSuccess).toBe(true);

        const updatedContract = JSON.parse(
          await readJsonFileWhenReady(contractJsonPath, timeouts.typeScriptCompilation),
        );
        expect(updatedContract.storage).toMatchObject({
          tables: {
            user: {
              columns: {
                name: { nullable: true },
              },
            },
          },
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      're-emits contract when contract.prisma is modified',
      async () => {
        const testSetup = setupTestDirectoryFromFixtures(createTempDir, pslFixtureSubdir);
        const testDir = testSetup.testDir;
        const outputDir = testSetup.outputDir;
        const schemaPath = join(testDir, 'contract.prisma');
        const contractJsonPath = join(outputDir, 'contract.json');

        copyFixtureFiles(testDir, pslFixtureSubdir, [
          'vite.config.ts',
          'contract.prisma',
          'contract-alt.prisma',
        ]);

        server = await createServer({
          root: testDir,
          logLevel: 'silent',
          server: {
            middlewareMode: true,
          },
        });

        const initialEmitSuccess = await waitForFileChange(
          contractJsonPath,
          null,
          timeouts.typeScriptCompilation,
        );
        expect(initialEmitSuccess).toBe(true);

        const initialContract = JSON.parse(
          await readJsonFileWhenReady(contractJsonPath, timeouts.typeScriptCompilation),
        );
        expect(initialContract.storage).toMatchObject({
          tables: {
            user: {
              columns: {
                email: expect.anything(),
              },
            },
          },
        });
        expect(initialContract.storage.tables.user.columns).not.toHaveProperty('name');

        const { stat } = await import('node:fs/promises');
        const initialStats = await stat(contractJsonPath);
        const initialMtime = initialStats.mtimeMs;

        await new Promise((resolve) => setTimeout(resolve, 100));

        replaceInFileOrThrow(schemaPath, '  email String\n', '  email String\n  name  String?\n');

        server.watcher.emit('change', schemaPath);

        const reEmitSuccess = await waitForFileChange(
          contractJsonPath,
          initialMtime,
          timeouts.typeScriptCompilation,
        );
        expect(reEmitSuccess).toBe(true);

        const updatedContract = JSON.parse(
          await readJsonFileWhenReady(contractJsonPath, timeouts.typeScriptCompilation),
        );
        expect(updatedContract.storage).toMatchObject({
          tables: {
            user: {
              columns: {
                name: { nullable: true },
              },
            },
          },
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      're-emits contract when config changes the authoritative inputs',
      async () => {
        const testSetup = setupTestDirectoryFromFixtures(createTempDir, pslFixtureSubdir);
        const testDir = testSetup.testDir;
        const outputDir = testSetup.outputDir;
        const configPath = testSetup.configPath;
        const altSchemaPath = join(testDir, 'contract-alt.prisma');
        const contractJsonPath = join(outputDir, 'contract.json');

        copyFixtureFiles(testDir, pslFixtureSubdir, [
          'vite.config.ts',
          'contract.prisma',
          'contract-alt.prisma',
        ]);

        server = await createServer({
          root: testDir,
          logLevel: 'silent',
          server: {
            middlewareMode: true,
          },
        });

        const initialEmitSuccess = await waitForFileChange(
          contractJsonPath,
          null,
          timeouts.typeScriptCompilation,
        );
        expect(initialEmitSuccess).toBe(true);

        const initialContract = JSON.parse(
          await readJsonFileWhenReady(contractJsonPath, timeouts.typeScriptCompilation),
        );
        expect(initialContract.storage.tables.user.columns).not.toHaveProperty('name');

        const { stat } = await import('node:fs/promises');
        const initialStats = await stat(contractJsonPath);
        const initialMtime = initialStats.mtimeMs;

        await new Promise((resolve) => setTimeout(resolve, 100));

        replaceInFileOrThrow(configPath, './contract.prisma', './contract-alt.prisma');

        const configModules = server.moduleGraph.getModulesByFile(configPath);
        if (configModules) {
          for (const module of configModules) {
            server.moduleGraph.invalidateModule(module);
          }
        }
        server.watcher.emit('change', configPath);

        const configReEmitSuccess = await waitForFileChange(
          contractJsonPath,
          initialMtime,
          timeouts.typeScriptCompilation,
        );
        expect(configReEmitSuccess).toBe(true);

        const contractAfterConfigChange = JSON.parse(
          await readJsonFileWhenReady(contractJsonPath, timeouts.typeScriptCompilation),
        );
        expect(contractAfterConfigChange.storage).toMatchObject({
          tables: {
            user: {
              columns: {
                name: { nullable: true },
              },
            },
          },
        });

        const updatedStats = await stat(contractJsonPath);
        const updatedMtime = updatedStats.mtimeMs;

        await new Promise((resolve) => setTimeout(resolve, 100));

        replaceInFileOrThrow(
          altSchemaPath,
          '  name  String?\n',
          '  name  String?\n  nickname String?\n',
        );

        server.watcher.emit('change', altSchemaPath);

        const altSchemaReEmitSuccess = await waitForFileChange(
          contractJsonPath,
          updatedMtime,
          timeouts.typeScriptCompilation,
        );
        expect(altSchemaReEmitSuccess).toBe(true);

        const contractAfterAltEdit = JSON.parse(
          await readJsonFileWhenReady(contractJsonPath, timeouts.typeScriptCompilation),
        );
        expect(contractAfterAltEdit.storage).toMatchObject({
          tables: {
            user: {
              columns: {
                nickname: { nullable: true },
              },
            },
          },
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
