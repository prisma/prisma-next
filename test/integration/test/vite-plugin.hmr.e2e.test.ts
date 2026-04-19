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

/**
 * Waits for a file to be modified (mtime changes) or created.
 * Returns true if the file was modified/created within the timeout, false otherwise.
 */
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
        // Set up test directory from fixtures
        const testSetup = setupTestDirectoryFromFixtures(createTempDir, tsFixtureSubdir);
        const testDir = testSetup.testDir;
        const outputDir = testSetup.outputDir;
        const contractPath = testSetup.contractPath;

        copyFixtureFiles(testDir, tsFixtureSubdir, ['vite.config.ts']);

        const contractJsonPath = join(outputDir, 'contract.json');

        // Start Vite dev server programmatically
        server = await createServer({
          root: testDir,
          logLevel: 'silent',
          server: {
            // Don't actually start HTTP server, we just need the plugin system
            middlewareMode: true,
          },
        });

        // Wait for initial emit (Vite plugin startup can be slow)
        const initialEmitSuccess = await waitForFileChange(
          contractJsonPath,
          null,
          timeouts.typeScriptCompilation,
        );
        expect(initialEmitSuccess).toBe(true);

        // Read initial contract to verify it was emitted correctly
        const initialContract = JSON.parse(readFileSync(contractJsonPath, 'utf-8'));
        expect(initialContract.storage).toMatchObject({
          tables: {
            user: {
              columns: {
                email: expect.anything(),
              },
            },
          },
        });

        // Get the mtime of the initial contract
        const { stat } = await import('node:fs/promises');
        const initialStats = await stat(contractJsonPath);
        const initialMtime = initialStats.mtimeMs;

        // Wait a bit to ensure mtime will be different
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Modify contract.ts - add a new column
        replaceInFileOrThrow(
          contractPath,
          '        email: field.column(textColumn),\n',
          '        email: field.column(textColumn),\n        name: field.column(textColumn).optional(),\n',
        );

        // Trigger HMR by invalidating the module
        const contractModuleId = contractPath;
        const mod = server.moduleGraph.getModulesByFile(contractModuleId);
        if (mod) {
          for (const m of mod) {
            server.moduleGraph.invalidateModule(m);
          }
        }

        // Simulate file change event
        server.watcher.emit('change', contractPath);

        // Wait for re-emit (contract.json should be updated)
        const reEmitSuccess = await waitForFileChange(
          contractJsonPath,
          initialMtime,
          timeouts.typeScriptCompilation,
        );
        expect(reEmitSuccess).toBe(true);

        // Verify the new contract has the additional column
        const updatedContract = JSON.parse(readFileSync(contractJsonPath, 'utf-8'));
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
        const originalCwd = process.cwd();

        copyFixtureFiles(testDir, pslFixtureSubdir, [
          'vite.config.ts',
          'contract.prisma',
          'contract-alt.prisma',
        ]);

        try {
          process.chdir(testDir);

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

          const initialContract = JSON.parse(readFileSync(contractJsonPath, 'utf-8'));
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

          const updatedContract = JSON.parse(readFileSync(contractJsonPath, 'utf-8'));
          expect(updatedContract.storage).toMatchObject({
            tables: {
              user: {
                columns: {
                  name: { nullable: true },
                },
              },
            },
          });
        } finally {
          process.chdir(originalCwd);
        }
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
        const originalCwd = process.cwd();

        copyFixtureFiles(testDir, pslFixtureSubdir, [
          'vite.config.ts',
          'contract.prisma',
          'contract-alt.prisma',
        ]);

        try {
          process.chdir(testDir);

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

          const initialContract = JSON.parse(readFileSync(contractJsonPath, 'utf-8'));
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

          const contractAfterConfigChange = JSON.parse(readFileSync(contractJsonPath, 'utf-8'));
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

          const contractAfterAltEdit = JSON.parse(readFileSync(contractJsonPath, 'utf-8'));
          expect(contractAfterAltEdit.storage).toMatchObject({
            tables: {
              user: {
                columns: {
                  nickname: { nullable: true },
                },
              },
            },
          });
        } finally {
          process.chdir(originalCwd);
        }
      },
      timeouts.spinUpPpgDev,
    );
  });
});
