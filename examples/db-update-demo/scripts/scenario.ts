import pc from 'picocolors';
import { applyContract } from './lib/contracts';
import { executeSql, resetDatabase } from './lib/db';
import { planDdlSql, printDdlSql } from './lib/ddl-sql';
import { getScenarioUrl, parseScenarioArg } from './lib/env';
import { baseArgs, runPrismaNext } from './lib/prisma-next';

interface ScenarioContext {
  readonly scenario: number;
  readonly url: string;
  readonly env: Record<string, string>;
  readonly showSql: boolean;
}

type ScenarioAction = 'run' | 'setup' | 'restore';

type Scenario = {
  readonly name: string;
  readonly setup: (ctx: ScenarioContext) => Promise<void>;
  readonly run: (ctx: ScenarioContext) => Promise<void>;
};

function printUsage(): void {
  console.log(`
Usage:
  bun run scripts/scenario.ts <scenario> [--setup|--restore] [--sql]

Examples:
  bun run scripts/scenario.ts 1
  bun run scripts/scenario.ts 2 --setup
  bun run scripts/scenario.ts 2 --sql
  bun run scripts/scenario.ts 7 --restore
`);
}

function parseAction(args: string[]): ScenarioAction {
  if (args.includes('--setup') || args.includes('--restore')) {
    return 'setup';
  }
  return 'run';
}

function parseShowSql(args: string[]): boolean {
  return args.includes('--sql');
}

type Phase = 'setup' | 'run' | 'sql' | 'warn' | 'info';

function logPhase(phase: Phase, message: string): void {
  const tag = (() => {
    switch (phase) {
      case 'setup':
        return pc.blue('setup');
      case 'run':
        return pc.green('run');
      case 'sql':
        return pc.magenta('sql');
      case 'warn':
        return pc.yellow('warn');
      case 'info':
        return pc.cyan('info');
      default:
        return phase;
    }
  })();
  console.log(`${pc.bold(`[${tag}]`)} ${message}`);
}

async function maybePrintDdl(ctx: ScenarioContext, mode: 'db-init' | 'db-update', title: string) {
  if (!ctx.showSql) return;
  logPhase('sql', `Previewing DDL for ${title}...`);
  const result = await planDdlSql(ctx.url, mode, {
    requireMarker: mode === 'db-update',
  });
  printDdlSql(title, result);
}

async function emitContract(ctx: ScenarioContext): Promise<void> {
  logPhase('setup', 'Emitting contract...');
  await runPrismaNext(['contract', 'emit', ...baseArgs()], { env: ctx.env });
}

async function dbInit(ctx: ScenarioContext): Promise<void> {
  logPhase('setup', 'Running db init...');
  await maybePrintDdl(ctx, 'db-init', 'db init');
  await runPrismaNext(['db', 'init', ...baseArgs(), '--db', ctx.url], { env: ctx.env });
}

async function dbUpdatePlan(ctx: ScenarioContext, extraArgs: string[] = []): Promise<void> {
  logPhase('run', 'Planning db update...');
  await maybePrintDdl(ctx, 'db-update', 'db update plan');
  await runPrismaNext(['db', 'update', ...baseArgs(), '--db', ctx.url, '--plan', ...extraArgs], {
    env: ctx.env,
  });
}

async function dbUpdateApply(ctx: ScenarioContext, extraArgs: string[] = []): Promise<void> {
  logPhase('run', 'Applying db update...');
  await maybePrintDdl(ctx, 'db-update', 'db update apply');
  await runPrismaNext(['db', 'update', ...baseArgs(), '--db', ctx.url, ...extraArgs], {
    env: ctx.env,
  });
}

async function dbUpdateApplyAllowFailure(ctx: ScenarioContext): Promise<void> {
  logPhase('run', 'Applying db update (expected failure)...');
  await maybePrintDdl(ctx, 'db-update', 'db update apply');
  const exitCode = await runPrismaNext(['db', 'update', ...baseArgs(), '--db', ctx.url], {
    env: ctx.env,
    allowFailure: true,
  });
  if (exitCode === 0) {
    logPhase('warn', 'db update succeeded; this scenario expects a failure to demonstrate errors.');
  }
}

async function resetAndBaseContract(ctx: ScenarioContext, variant: 'v1' | 'v2') {
  logPhase('setup', 'Resetting database...');
  await resetDatabase(ctx.url);
  logPhase('setup', `Applying contract ${variant}...`);
  applyContract(variant);
  await emitContract(ctx);
}

const scenarios: Record<number, Scenario> = {
  1: {
    name: 'Missing marker (fails fast)',
    setup: async (ctx) => {
      await resetAndBaseContract(ctx, 'v1');
    },
    run: async (ctx) => {
      await dbUpdateApplyAllowFailure(ctx);
    },
  },
  2: {
    name: 'Preview a contract change (plan mode)',
    setup: async (ctx) => {
      await resetAndBaseContract(ctx, 'v1');
      await dbInit(ctx);
      logPhase('setup', 'Switching to contract v2...');
      applyContract('v2');
      await emitContract(ctx);
    },
    run: async (ctx) => {
      await dbUpdatePlan(ctx);
    },
  },
  3: {
    name: 'Apply the update',
    setup: async (ctx) => {
      await resetAndBaseContract(ctx, 'v1');
      await dbInit(ctx);
      logPhase('setup', 'Switching to contract v2...');
      applyContract('v2');
      await emitContract(ctx);
    },
    run: async (ctx) => {
      await dbUpdateApply(ctx);
    },
  },
  4: {
    name: 'No-op update',
    setup: async (ctx) => {
      await resetAndBaseContract(ctx, 'v1');
      await dbInit(ctx);
    },
    run: async (ctx) => {
      await dbUpdateApply(ctx);
    },
  },
  5: {
    name: 'Destructive changes with safety review',
    setup: async (ctx) => {
      await resetAndBaseContract(ctx, 'v1');
      await dbInit(ctx);
      logPhase('setup', 'Adding drift (legacy_code, legacy_audit)...');
      await executeSql(ctx.url, 'ALTER TABLE "public"."account" ADD COLUMN "legacy_code" text');
      await executeSql(
        ctx.url,
        'CREATE TABLE IF NOT EXISTS "public"."legacy_audit" (id int4 primary key, note text)',
      );
    },
    run: async (ctx) => {
      await dbUpdatePlan(ctx);
    },
  },
  6: {
    name: 'Planning conflicts',
    setup: async (ctx) => {
      await resetAndBaseContract(ctx, 'v1');
      await dbInit(ctx);
      logPhase('setup', 'Introducing a primary key mismatch...');
      await executeSql(
        ctx.url,
        'ALTER TABLE "public"."project" DROP CONSTRAINT IF EXISTS "project_accountId_fkey"',
      );
      await executeSql(
        ctx.url,
        'ALTER TABLE "public"."account" DROP CONSTRAINT IF EXISTS "account_pkey"',
      );
      await executeSql(ctx.url, 'ALTER TABLE "public"."account" ADD PRIMARY KEY ("email")');
    },
    run: async (ctx) => {
      await dbUpdateApplyAllowFailure(ctx);
    },
  },
  7: {
    name: 'Runner failure after planning',
    setup: async (ctx) => {
      await resetAndBaseContract(ctx, 'v1');
      await dbInit(ctx);
      logPhase('setup', 'Adding drift + blocking view to force runner failure...');
      await executeSql(ctx.url, 'ALTER TABLE "public"."project" ADD COLUMN "legacy_notes" text');
      await executeSql(
        ctx.url,
        'CREATE VIEW "public"."legacy_notes_view" AS SELECT id, legacy_notes FROM "public"."project"',
      );
    },
    run: async (ctx) => {
      await dbUpdateApplyAllowFailure(ctx);
    },
  },
  8: {
    name: 'JSON output for tooling',
    setup: async (ctx) => {
      await resetAndBaseContract(ctx, 'v1');
      await dbInit(ctx);
      logPhase('setup', 'Switching to contract v2...');
      applyContract('v2');
      await emitContract(ctx);
    },
    run: async (ctx) => {
      await dbUpdatePlan(ctx, ['--json']);
    },
  },
  9: {
    name: 'Use config connection or override it',
    setup: async (ctx) => {
      await resetAndBaseContract(ctx, 'v1');
      await dbInit(ctx);
    },
    run: async (ctx) => {
      await runPrismaNext(['db', 'update', ...baseArgs()], { env: ctx.env });
      await runPrismaNext(['db', 'update', ...baseArgs(), '--db', ctx.url], { env: ctx.env });
    },
  },
};

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const scenario = parseScenarioArg(args[0]);
  const action = parseAction(args);
  const showSql = parseShowSql(args);
  const isRestore = args.includes('--restore') || args.includes('--setup');
  const selected = scenarios[scenario];
  if (!selected) {
    throw new Error(`Scenario ${scenario} is not defined.`);
  }

  const url = getScenarioUrl(scenario);
  const ctx: ScenarioContext = {
    scenario,
    url,
    env: {
      DATABASE_URL: url,
    },
    showSql,
  };

  console.log(`\n${pc.bold(pc.white(`Scenario ${scenario}:`))} ${pc.bold(selected.name)}`);
  logPhase('info', `Database: ${ctx.url}`);
  if (showSql) {
    logPhase('info', 'DDL preview enabled (--sql).');
  }
  if (action === 'setup' && isRestore) {
    logPhase('info', 'Restore mode (--restore).');
  }

  if (action === 'setup') {
    await selected.setup(ctx);
    logPhase('info', 'Setup complete.');
    return;
  }

  await selected.setup(ctx);
  await selected.run(ctx);
}

await main();
