import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadContractFromTs } from '@prisma-next/cli';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type AuthoringId,
  dbFile,
  starterSchema,
  type TargetId,
  targetPackageName,
} from '../../../packages/1-framework/3-tooling/cli/src/commands/init/templates/code-templates';
import { createIntegrationTestDir } from './utils/cli-test-helpers';

function testConfigFile(target: TargetId, contractPath: string): string {
  const pkg = targetPackageName(target);
  return `import { defineConfig } from '${pkg}/config';

export default defineConfig({
  contract: '${contractPath}',
  db: {
    connection: 'postgresql://localhost/test',
  },
});
`;
}

function writeInitFiles(
  testDir: string,
  target: TargetId,
  authoring: AuthoringId,
): { schemaPath: string; configPath: string } {
  const ext = authoring === 'typescript' ? 'ts' : 'prisma';
  const schemaPath = `prisma/contract.${ext}`;
  const schemaDir = dirname(schemaPath);

  mkdirSync(join(testDir, schemaDir), { recursive: true });
  writeFileSync(join(testDir, schemaPath), starterSchema(target, authoring), 'utf-8');

  const configContent = testConfigFile(target, `./${schemaPath}`);
  const configPath = join(testDir, 'prisma-next.config.ts');
  writeFileSync(configPath, configContent, 'utf-8');

  writeFileSync(join(testDir, schemaDir, 'db.ts'), dbFile(target), 'utf-8');

  return { schemaPath, configPath };
}

describe('init template validity', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createIntegrationTestDir();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('TypeScript contract authoring', () => {
    it(
      'postgres + typescript: generated contract loads and produces a valid contract',
      async () => {
        const { schemaPath } = writeInitFiles(testDir, 'postgres', 'typescript');
        const contractPath = join(testDir, schemaPath);

        const contract = await loadContractFromTs(contractPath);

        expect(contract).toBeDefined();
        expect(contract.targetFamily).toBe('sql');
        expect(contract.target).toBe('postgres');
        const storage = (contract as Record<string, unknown>).storage as Record<string, unknown>;
        expect(storage.tables).toBeDefined();
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'mongo + typescript: generated contract loads and produces a valid contract',
      async () => {
        const { schemaPath } = writeInitFiles(testDir, 'mongo', 'typescript');
        const contractPath = join(testDir, schemaPath);

        const contract = await loadContractFromTs(contractPath);

        expect(contract).toBeDefined();
        expect(contract.targetFamily).toBe('mongo');
        expect(contract.target).toBe('mongo');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('generated db.ts validity', () => {
    it('postgres db.ts imports from facade runtime export', () => {
      const db = dbFile('postgres');

      expect(db).toContain("from '@prisma-next/postgres/runtime'");
      expect(db).toContain("from './contract.d'");
      expect(db).toContain("from './contract.json'");
    });

    it('mongo db.ts imports from facade runtime export', () => {
      const db = dbFile('mongo');

      expect(db).toContain("from '@prisma-next/mongo/runtime'");
      expect(db).toContain("from './contract.d'");
      expect(db).toContain("from './contract.json'");
    });
  });

  describe('PSL contract authoring', () => {
    it(
      'postgres + psl: generated contract emits valid artifacts via executeContractEmit',
      async () => {
        const { configPath, schemaPath } = writeInitFiles(testDir, 'postgres', 'psl');
        const schemaDir = dirname(schemaPath);

        const { executeContractEmit } = await import(
          '../../../packages/1-framework/3-tooling/cli/src/control-api/operations/contract-emit'
        );

        const originalCwd = process.cwd();
        try {
          process.chdir(testDir);
          await executeContractEmit({ configPath });
        } finally {
          process.chdir(originalCwd);
        }

        const contractJsonPath = join(testDir, schemaDir, 'contract.json');
        const contractDtsPath = join(testDir, schemaDir, 'contract.d.ts');

        expect(existsSync(contractJsonPath)).toBe(true);
        expect(existsSync(contractDtsPath)).toBe(true);

        const contractJson = JSON.parse(readFileSync(contractJsonPath, 'utf-8'));
        expect(contractJson.targetFamily).toBe('sql');
        expect(contractJson.target).toBe('postgres');
        expect(contractJson.storage.tables).toHaveProperty('user');
        expect(contractJson.storage.tables).toHaveProperty('post');

        const dts = readFileSync(contractDtsPath, 'utf-8');
        expect(dts).toContain('export type Contract');
      },
      timeouts.spinUpPpgDev,
    );
  });
});
