import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import { createContractEmitCommand } from '../packages/1-framework/3-tooling/cli/src/commands/contract-emit';
import { createDbInitCommand } from '../packages/1-framework/3-tooling/cli/src/commands/db-init';
import { withClient, withDevDatabase } from '../test/utils/src/exports/index';

type ScenarioMode = {
  readonly id: string;
  readonly label: string;
  readonly buildArgs: (baseArgs: string[]) => string[];
};

interface ScenarioContext {
  readonly testDir: string;
  readonly configPath: string;
  readonly contractDir: string;
  readonly connectionString: string;
}

interface ScenarioDefinition {
  readonly id: string;
  readonly description: string;
  readonly extraArgs?: readonly string[];
  readonly schemaSql?: string;
  readonly modes?: readonly ScenarioMode[];
  readonly prepare?: (ctx: ScenarioContext) => Promise<void>;
  readonly beforeMeasuredRun?: (
    ctx: ScenarioContext,
    runHelper: (args: readonly string[]) => Promise<void>,
  ) => Promise<void>;
}

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

interface ScenarioResult extends RunResult {
  readonly scenarioId: string;
  readonly description: string;
  readonly modeId: string;
  readonly modeLabel: string;
  readonly args: readonly string[];
}

const fixtureRoot = path.join(
  process.cwd(),
  'test',
  'integration',
  'test',
  'fixtures',
  'cli',
  'cli-e2e-test-app',
);
const fixtureSubdir = path.join(fixtureRoot, 'fixtures', 'db-init');

const defaultModes: readonly ScenarioMode[] = [
  {
    id: 'human',
    label: 'default (--no-color)',
    buildArgs: (baseArgs) => [...baseArgs, '--no-color'],
  },
  {
    id: 'json',
    label: '--json object',
    buildArgs: (baseArgs) => [...baseArgs, '--json'],
  },
];

const scenarios: readonly ScenarioDefinition[] = [
  { id: 'apply-empty', description: 'Empty database apply' },
  { id: 'plan-mode', description: 'Plan mode dry run', extraArgs: ['--plan'] },
  {
    id: 'idempotent-second-run',
    description: 'Second run after success is noop',
    beforeMeasuredRun: async (ctx, runHelper) => {
      const configArg = path.basename(ctx.configPath);
      await runHelper(['--config', configArg, '--no-color']);
    },
  },
  { id: 'quiet-mode', description: '--quiet output', extraArgs: ['--quiet'] },
  { id: 'verbose-mode', description: '--verbose output', extraArgs: ['--verbose'] },
  { id: 'trace-mode', description: '--trace output', extraArgs: ['--trace'] },
  {
    id: 'missing-contract',
    description: 'Missing contract file',
    prepare: async (ctx) => {
      await removeFile(path.join(ctx.contractDir, 'contract.json'));
    },
  },
  {
    id: 'invalid-contract-json',
    description: 'Invalid contract JSON',
    prepare: async (ctx) => {
      await writeFile(path.join(ctx.contractDir, 'contract.json'), '{ invalid json', 'utf-8');
    },
  },
  {
    id: 'missing-db-url',
    description: 'No db.url configured',
    prepare: async (ctx) => {
      await rewriteConfig(ctx, { includeDb: false });
    },
  },
  {
    id: 'missing-driver',
    description: 'No driver configured',
    prepare: async (ctx) => {
      await rewriteConfig(ctx, { includeDriver: false });
    },
  },
  {
    id: 'target-no-migrations',
    description: 'Target without migrations capability',
    prepare: async (ctx) => {
      await rewriteConfig(ctx, { targetNoMigrations: true });
    },
  },
  {
    id: 'connect-failure',
    description: 'Database connection fails',
    prepare: async (ctx) => {
      await rewriteConfig(ctx, {
        dbUrl: 'postgresql://127.0.0.1:59999/postgres?user=postgres&password=postgres',
      });
    },
  },
  {
    id: 'planner-conflict',
    description: 'Existing conflicting schema',
    schemaSql: `
      CREATE TABLE IF NOT EXISTS "user" (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL
      );
    `,
  },
  {
    id: 'marker-mismatch',
    description: 'Existing marker mismatches destination',
    beforeMeasuredRun: async (ctx, runHelper) => {
      const configArg = path.basename(ctx.configPath);
      await runHelper(['--config', configArg, '--no-color']);
      await withClient(ctx.connectionString, async (client) => {
        await client.query('CREATE SCHEMA IF NOT EXISTS prisma_contract');
        await client.query(`
          CREATE TABLE IF NOT EXISTS prisma_contract.marker (
            id INTEGER PRIMARY KEY DEFAULT 1,
            core_hash TEXT NOT NULL,
            profile_hash TEXT NOT NULL,
            contract_json JSONB,
            canonical_version INTEGER,
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            app_tag TEXT,
            meta JSONB DEFAULT '{}'
          )
        `);
        await client.query(`
          INSERT INTO prisma_contract.marker (id, core_hash, profile_hash, contract_json)
          VALUES (1, 'sha256:different-hash', 'sha256:different-profile', '{}')
          ON CONFLICT (id) DO UPDATE
            SET core_hash = EXCLUDED.core_hash,
                profile_hash = EXCLUDED.profile_hash
        `);
      });
    },
  },
  {
    id: 'ndjson',
    description: '--json ndjson flag',
    modes: [
      {
        id: 'ndjson',
        label: '--json ndjson',
        buildArgs: (baseArgs) => [...baseArgs, '--json', 'ndjson'],
      },
    ],
  },
];

async function removeFile(filePath: string): Promise<void> {
  try {
    await writeFile(filePath, '', { flag: 'w' });
    rmSync(filePath, { force: true });
  } catch {
    // ignore
  }
}

async function rewriteConfig(
  ctx: ScenarioContext,
  options: {
    includeDb?: boolean;
    includeDriver?: boolean;
    targetNoMigrations?: boolean;
    dbUrl?: string;
  },
): Promise<void> {
  const content = buildConfigTemplate({
    connectionString: ctx.connectionString,
    includeDb: options.includeDb ?? true,
    includeDriver: options.includeDriver ?? true,
    targetNoMigrations: options.targetNoMigrations ?? false,
    dbUrl: options.dbUrl,
  });
  await writeFile(ctx.configPath, content, 'utf-8');
}

function buildConfigTemplate(options: {
  readonly connectionString: string;
  readonly includeDb: boolean;
  readonly includeDriver: boolean;
  readonly targetNoMigrations: boolean;
  readonly dbUrl?: string;
}): string {
  const targetOverride = options.targetNoMigrations
    ? `
const targetWithoutMigrations = { ...postgres };
delete (targetWithoutMigrations as { migrations?: unknown }).migrations;
`
    : '';
  const targetRef = options.targetNoMigrations ? 'targetWithoutMigrations' : 'postgres';
  const driverLine = options.includeDriver ? '  driver: postgresDriver,\n' : '';
  const dbLine = options.includeDb
    ? `  db: {
    url: '${options.dbUrl ?? options.connectionString}',
  },\n`
    : '';

  return `import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';
import { contract } from './contract';

${targetOverride}

export default defineConfig({
  family: sql,
  target: ${targetRef},
  adapter: postgresAdapter,
${driverLine}  extensions: [],
  contract: {
    source: contract,
    output: 'src/prisma/contract.json',
    types: 'src/prisma/contract.d.ts',
  },
${dbLine}});\n`;
}

function createTempProjectDir(): string {
  const dir = path.join(fixtureRoot, `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function copyFixture(testDir: string): Promise<{ configPath: string; contractDir: string }> {
  mkdirSync(testDir, { recursive: true });
  const contractDir = path.join(testDir, 'src/prisma');
  mkdirSync(contractDir, { recursive: true });
  const filesToCopy: Array<{ file: string; targetDir: 'root' | 'contract' }> = [
    { file: 'contract.ts', targetDir: 'root' },
    { file: 'contract.json', targetDir: 'contract' },
    { file: 'contract.d.ts', targetDir: 'contract' },
  ];
  for (const { file, targetDir } of filesToCopy) {
    const source = path.join(fixtureSubdir, file);
    if (existsSync(source)) {
      const destination =
        targetDir === 'contract' ? path.join(contractDir, file) : path.join(testDir, file);
      copyFileSync(source, destination);
    }
  }
  const templatePath = path.join(fixtureSubdir, 'prisma-next.config.with-db.ts');
  const configPath = path.join(testDir, 'prisma-next.config.ts');
  const template = await readFile(templatePath, 'utf-8');
  writeFileSync(configPath, template);
  return { configPath, contractDir };
}

async function runCliCommand(
  command: Command,
  cwd: string,
  args: readonly string[],
): Promise<RunResult> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalExit = process.exit;
  const exitMarker = new Error('__exit__');
  let exitCode: number | undefined;

  console.log = (...messages: unknown[]) => {
    stdoutChunks.push(messages.map(String).join(' '));
  };
  console.error = (...messages: unknown[]) => {
    stderrChunks.push(messages.map(String).join(' '));
  };
  (process.exit as typeof process.exit) = ((code?: number) => {
    exitCode = code ?? 0;
    throw exitMarker;
  }) as typeof process.exit;

  const previousCwd = process.cwd();
  try {
    process.chdir(cwd);
    await command.parseAsync(args, { from: 'user' });
    exitCode ??= 0;
  } catch (error) {
    if (error === exitMarker) {
      // process.exit mock triggered
    } else if (error instanceof Error) {
      stderrChunks.push(error.stack ?? error.message);
      exitCode = exitCode ?? 1;
    } else {
      stderrChunks.push(String(error));
      exitCode = exitCode ?? 1;
    }
  } finally {
    process.chdir(previousCwd);
    console.log = originalLog;
    console.error = originalError;
    process.exit = originalExit;
  }

  return {
    stdout: stdoutChunks.join('\n'),
    stderr: stderrChunks.join('\n'),
    exitCode: exitCode ?? 0,
  };
}

async function setupScenario(
  connectionString: string,
  schemaSql?: string,
): Promise<ScenarioContext> {
  if (schemaSql) {
    await withClient(connectionString, async (client) => {
      await client.query(schemaSql);
    });
  }

  const testDir = createTempProjectDir();
  const { configPath, contractDir } = await copyFixture(testDir);
  const configContent = await readFile(configPath, 'utf-8');
  await writeFile(configPath, configContent.replace(/{{DB_URL}}/g, connectionString));

  const emitCommand = createContractEmitCommand();
  await runCliCommand(emitCommand, testDir, ['--config', 'prisma-next.config.ts', '--no-color']);

  const scenarioConfigPath = path.join(testDir, 'scenario.config.ts');
  await rename(configPath, scenarioConfigPath);

  return { testDir, configPath: scenarioConfigPath, contractDir, connectionString };
}

async function runScenario(def: ScenarioDefinition): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  await withDevDatabase(async ({ connectionString }) => {
    const ctx = await setupScenario(connectionString, def.schemaSql);
    try {
      if (def.prepare) {
        await def.prepare(ctx);
      }
      const configFile = def.configFile ?? path.basename(ctx.configPath);
      const baseArgs = ['--config', configFile, ...(def.extraArgs ?? [])];
      if (def.beforeMeasuredRun) {
        await def.beforeMeasuredRun(ctx, async (args) => {
          const command = createDbInitCommand();
          await runCliCommand(command, ctx.testDir, args);
        });
      }
      const modes = def.modes ?? defaultModes;
      for (const mode of modes) {
        const args = mode.buildArgs(baseArgs);
        const command = createDbInitCommand();
        const runResult = await runCliCommand(command, ctx.testDir, args);
        results.push({
          scenarioId: def.id,
          description: def.description,
          modeId: mode.id,
          modeLabel: mode.label,
          args,
          ...runResult,
        });
      }
    } finally {
      rmSync(ctx.testDir, { recursive: true, force: true });
    }
  });
  return results;
}

async function main(): Promise<void> {
  const allResults: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    const scenarioResults = await runScenario(scenario);
    allResults.push(...scenarioResults);
  }

  const outputPath = path.join(
    'agent-os',
    'specs',
    '2025-12-05-db-init-command',
    'verifications',
    'db-init-ux-review.before.json',
  );
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(allResults, null, 2));
  console.log(
    `Manual db init matrix complete. Wrote ${allResults.length} entries to ${outputPath}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
