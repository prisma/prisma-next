import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { timeouts } from '@prisma-next/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type AuthoringId,
  dbFile,
  starterSchema,
  type TargetId,
  targetPackageName,
} from '../../../packages/1-framework/3-tooling/cli/src/commands/init/templates/code-templates';
import {
  defaultTsConfig,
  REQUIRED_COMPILER_OPTIONS,
} from '../../../packages/1-framework/3-tooling/cli/src/commands/init/templates/tsconfig';
import { createIntegrationTestDir } from './utils/cli-test-helpers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const tscPath = resolve(__dirname, '../node_modules/.bin/tsc');

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
  writeFileSync(join(testDir, 'tsconfig.json'), defaultTsConfig(), 'utf-8');

  return { schemaPath, configPath };
}

async function emitContract(testDir: string, configPath: string): Promise<void> {
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
}

function writeScopedTsConfig(testDir: string, include: string[]): void {
  const config = JSON.parse(defaultTsConfig()) as Record<string, unknown>;
  config['include'] = include;
  writeFileSync(join(testDir, 'tsconfig.json'), JSON.stringify(config, null, 2), 'utf-8');
}

async function typecheck(testDir: string): Promise<void> {
  if (!existsSync(tscPath)) {
    throw new Error(`tsc not found at ${tscPath}`);
  }
  try {
    await execFileAsync(tscPath, ['--noEmit', '--project', 'tsconfig.json'], {
      cwd: testDir,
    });
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; message?: string };
    const details = [execError.stdout, execError.stderr, execError.message]
      .filter(Boolean)
      .join('\n');
    throw new Error(`tsc --noEmit failed in ${testDir}:\n${details}`);
  }
}

const TYPECHECK_TIMEOUT = timeouts.typeScriptCompilation;

describe('init generates a typecheckable project', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createIntegrationTestDir();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('generated tsconfig includes all required compiler options', () => {
    const config = JSON.parse(defaultTsConfig()) as Record<string, unknown>;
    const opts = config['compilerOptions'] as Record<string, unknown>;

    for (const [key, value] of Object.entries(REQUIRED_COMPILER_OPTIONS)) {
      expect(opts[key], `compilerOptions.${key}`).toBe(value);
    }
  });

  it(
    'postgres + typescript: contract.ts typechecks with generated tsconfig',
    async () => {
      writeInitFiles(testDir, 'postgres', 'typescript');
      writeScopedTsConfig(testDir, ['prisma/contract.ts']);

      await typecheck(testDir);
    },
    TYPECHECK_TIMEOUT,
  );

  it(
    'mongo + typescript: contract.ts typechecks with generated tsconfig',
    async () => {
      writeInitFiles(testDir, 'mongo', 'typescript');
      writeScopedTsConfig(testDir, ['prisma/contract.ts']);

      await typecheck(testDir);
    },
    TYPECHECK_TIMEOUT,
  );

  it(
    'postgres + psl: full project typechecks after emit',
    async () => {
      const { configPath } = writeInitFiles(testDir, 'postgres', 'psl');
      await emitContract(testDir, configPath);

      expect(existsSync(join(testDir, 'prisma', 'contract.json'))).toBe(true);
      expect(existsSync(join(testDir, 'prisma', 'contract.d.ts'))).toBe(true);

      await typecheck(testDir);
    },
    TYPECHECK_TIMEOUT,
  );
});
