/**
 * Builds the live REPL context: loads prisma-next.config.ts, reads the
 * emitted contract.json, resolves the target's runtime facade from the
 * user's project (so the project's own installed packages execute the
 * queries), and constructs the lazy client.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '@prisma-next/config-loader';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { dirname, join, resolve } from 'pathe';
import { targetPackageName } from '../commands/init/templates/code-templates';
import {
  CliStructuredError,
  errorDatabaseConnectionRequired,
  errorUnexpected,
} from '../utils/cli-errors';
import { maskConnectionUrl } from '../utils/command-helpers';
import { extractReplSchemaInfo, type ReplSchemaInfo } from './schema-info';

/**
 * Structural view of the target runtime client (`postgres(...)` et al.).
 * The REPL treats the client as opaque user-space surface; only the members
 * it wires into the evaluator are typed.
 */
export interface ReplRuntimeClient {
  readonly sql: unknown;
  readonly orm: unknown;
  readonly enums: unknown;
  readonly raw: unknown;
  runtime(): { execute(plan: unknown): Promise<unknown> };
  close(): Promise<void>;
}

export interface ReplContext {
  readonly db: ReplRuntimeClient;
  readonly schema: ReplSchemaInfo;
  readonly targetId: string;
  readonly dbUrlMasked: string;
  readonly contractPath: string;
  executePlan(plan: unknown): Promise<unknown>;
  close(): Promise<void>;
}

export interface LoadReplContextOptions {
  readonly db?: string;
  readonly config?: string;
}

/** Targets whose facade runtime the REPL knows how to drive today. */
const REPL_SUPPORTED_TARGETS = ['postgres'] as const;
type ReplSupportedTarget = (typeof REPL_SUPPORTED_TARGETS)[number];

function isReplSupportedTarget(targetId: string): targetId is ReplSupportedTarget {
  return (REPL_SUPPORTED_TARGETS as readonly string[]).includes(targetId);
}

function extensionPackIds(contractJson: unknown): string[] {
  if (typeof contractJson !== 'object' || contractJson === null) return [];
  const packs = (contractJson as { extensionPacks?: unknown }).extensionPacks;
  if (typeof packs !== 'object' || packs === null) return [];
  return Object.keys(packs);
}

/**
 * Resolves the runtime descriptor for each extension pack the contract
 * requires, following the first-party naming convention
 * (`@prisma-next/extension-<id>/runtime`) with the bare id as fallback for
 * third-party packs.
 */
async function loadRuntimeExtensions(
  projectRequire: NodeJS.Require,
  contractJson: unknown,
): Promise<unknown[]> {
  const extensions: unknown[] = [];
  for (const id of extensionPackIds(contractJson)) {
    const candidates = [`@prisma-next/extension-${id}/runtime`, `${id}/runtime`];
    let resolved: string | undefined;
    for (const candidate of candidates) {
      try {
        resolved = projectRequire.resolve(candidate);
        break;
      } catch {
        // try the next candidate
      }
    }
    if (resolved === undefined) {
      throw new Error(
        `Contract requires extension pack '${id}', but neither ${candidates.join(' nor ')} resolves from the project`,
      );
    }
    const extensionModule: { default: unknown } = await import(pathToFileURL(resolved).href);
    extensions.push(extensionModule.default);
  }
  return extensions;
}

function isRuntimeClient(value: unknown): value is ReplRuntimeClient {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sql' in value &&
    'orm' in value &&
    'enums' in value &&
    'raw' in value &&
    typeof (value as { runtime?: unknown }).runtime === 'function' &&
    typeof (value as { close?: unknown }).close === 'function'
  );
}

export async function loadReplContext(
  options: LoadReplContextOptions,
): Promise<Result<ReplContext, CliStructuredError>> {
  let config: Awaited<ReturnType<typeof loadConfig>>;
  try {
    config = await loadConfig(options.config);
  } catch (error) {
    if (CliStructuredError.is(error)) return notOk(error);
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: 'Failed to load config',
      }),
    );
  }

  const configPath = resolve(options.config ?? 'prisma-next.config.ts');
  const projectDir = dirname(configPath);

  const dbConnection = options.db ?? config.db?.connection;
  if (typeof dbConnection !== 'string' || dbConnection.length === 0) {
    return notOk(
      errorDatabaseConnectionRequired({
        why: 'The repl needs a database to execute queries (set db.connection in prisma-next.config.ts, or pass --db <url>)',
        commandName: 'repl',
      }),
    );
  }

  const targetId = config.target.targetId;
  if (!isReplSupportedTarget(targetId)) {
    return notOk(
      errorUnexpected(`The repl does not support the '${targetId}' target yet`, {
        why: `Supported targets: ${REPL_SUPPORTED_TARGETS.join(', ')}`,
      }),
    );
  }
  // Single source of truth for the facade package name — shared with the
  // init scaffolding templates.
  const facadePackage = targetPackageName(targetId);

  const contractPath = config.contract?.output;
  if (contractPath === undefined) {
    return notOk(
      errorUnexpected('config.contract.output is required to load the contract', {
        why: 'The repl reads the emitted contract.json to build the query surfaces. Run `prisma-next contract emit` first.',
      }),
    );
  }

  let contractJson: unknown;
  try {
    contractJson = JSON.parse(await readFile(contractPath, 'utf8'));
  } catch (error) {
    return notOk(
      errorUnexpected(`Failed to read contract at ${contractPath}`, {
        why: error instanceof Error ? error.message : String(error),
        fix: 'Run `prisma-next contract emit` to generate contract.json.',
      }),
    );
  }

  let client: ReplRuntimeClient;
  try {
    const projectRequire = createRequire(join(projectDir, 'noop.js'));
    const runtimeModulePath = projectRequire.resolve(`${facadePackage}/runtime`);
    const runtimeModule: { default: (opts: unknown) => unknown } = await import(
      pathToFileURL(runtimeModulePath).href
    );
    const extensions = await loadRuntimeExtensions(projectRequire, contractJson);
    const created = runtimeModule.default({ contractJson, url: dbConnection, extensions });
    if (!isRuntimeClient(created)) {
      return notOk(
        errorUnexpected(`${facadePackage}/runtime did not return a client`, {
          why: 'The runtime facade default export must produce a client with sql/orm/enums/raw/runtime/close.',
        }),
      );
    }
    client = created;
  } catch (error) {
    return notOk(
      errorUnexpected(`Failed to load ${facadePackage}/runtime from the project`, {
        why: error instanceof Error ? error.message : String(error),
        fix: `Install ${facadePackage} in the project that owns ${configPath}.`,
      }),
    );
  }

  return ok({
    db: client,
    schema: extractReplSchemaInfo(contractJson),
    targetId,
    dbUrlMasked: maskConnectionUrl(dbConnection),
    contractPath,
    executePlan: (plan: unknown) => client.runtime().execute(plan),
    close: () => client.close(),
  });
}
