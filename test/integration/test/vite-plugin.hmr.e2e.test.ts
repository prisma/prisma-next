import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { timeouts } from '@prisma-next/test-utils';
import { createServer, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { setupTestDirectoryFromFixtures, withTempDir } from './utils/cli-test-helpers';

const fixtureSubdir = 'vite-plugin';

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
        const testSetup = setupTestDirectoryFromFixtures(createTempDir, fixtureSubdir);
        const testDir = testSetup.testDir;
        const outputDir = testSetup.outputDir;
        const contractPath = testSetup.contractPath;

        // Copy the vite.config.ts to the test directory
        // testDir is inside cli-e2e-test-app, so navigate up then into fixtures
        const fixtureViteConfig = join(testDir, '..', 'fixtures', fixtureSubdir, 'vite.config.ts');
        copyFileSync(fixtureViteConfig, join(testDir, 'vite.config.ts'));

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

        // Wait for initial emit
        const initialEmitSuccess = await waitForFileChange(contractJsonPath, null, 5000);
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
        const originalContractContent = readFileSync(contractPath, 'utf-8');
        const modifiedContractContent = originalContractContent.replace(
          ".column('email', { type: textColumn, nullable: false })",
          ".column('email', { type: textColumn, nullable: false })\n      .column('name', { type: textColumn, nullable: true })",
        );
        writeFileSync(contractPath, modifiedContractContent, 'utf-8');

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
        const reEmitSuccess = await waitForFileChange(contractJsonPath, initialMtime, 5000);
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
  });
});
