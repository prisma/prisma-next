import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { sanitizePrismaSchemaForPrisma7 } from './schema-normalize';

const require = createRequire(import.meta.url);

export interface PrismaDbPushOptions {
  readonly schemaPath: string;
  readonly url: string;
  readonly cwd?: string;
}

export interface PrismaDbPushResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface PrismaDbPullOptions {
  readonly schemaPath: string;
  readonly url: string;
  readonly cwd?: string;
}

export interface PrismaDbPullResult {
  readonly schema: string;
  readonly stdout: string;
  readonly stderr: string;
}

export interface PrismaDiffSqlOptions {
  readonly schemaPath: string;
  readonly url: string;
  readonly cwd?: string;
}

export interface PrismaDiffSqlResult {
  readonly sql: string;
}

export async function prismaDbPush(options: PrismaDbPushOptions): Promise<PrismaDbPushResult> {
  const { schemaPath, url, cwd } = options;
  const prepared = await prepareSchemaForPrismaCli(schemaPath);

  try {
    const result = await runPrismaCli(
      ['db', 'push', '--schema', prepared.schemaPath, '--url', url, '--accept-data-loss'],
      cwd ? { cwd } : {},
    );

    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } finally {
    await prepared.cleanup();
  }
}

export async function prismaDbPull(options: PrismaDbPullOptions): Promise<PrismaDbPullResult> {
  const { schemaPath, url, cwd } = options;
  const prepared = await prepareSchemaForPrismaCli(schemaPath);

  try {
    const result = await runPrismaCli(
      ['db', 'pull', '--schema', prepared.schemaPath, '--url', url, '--print'],
      cwd ? { cwd } : {},
    );

    const schema = extractPrintedSchema(result.stdout, result.stderr);
    return {
      schema,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } finally {
    await prepared.cleanup();
  }
}

export async function generatePrismaDiffSql(
  options: PrismaDiffSqlOptions,
): Promise<PrismaDiffSqlResult> {
  const { schemaPath, url, cwd } = options;
  const prepared = await prepareSchemaForPrismaCli(schemaPath);
  const tempDir = await mkdtemp(join(tmpdir(), 'prisma-next-prisma-diff-'));
  const outputPath = join(tempDir, 'migration.sql');
  const configPath = join(tempDir, 'prisma.config.ts');

  const configContent = [
    `import { defineConfig } from 'prisma/config';`,
    '',
    'export default defineConfig({',
    `  schema: ${JSON.stringify(prepared.schemaPath)},`,
    '  datasource: {',
    `    url: ${JSON.stringify(url)},`,
    '  },',
    '});',
    '',
  ].join('\n');

  await writeFile(configPath, configContent, 'utf8');

  try {
    await runPrismaCli(
      [
        'migrate',
        'diff',
        '--config',
        configPath,
        '--from-empty',
        '--to-schema',
        prepared.schemaPath,
        '--script',
        '--output',
        outputPath,
      ],
      { cwd: cwd ?? dirname(resolve(schemaPath)) },
    );

    const sql = await readFile(outputPath, 'utf8');
    return { sql };
  } finally {
    await prepared.cleanup();
    await rm(tempDir, { recursive: true, force: true });
  }
}

interface PrismaCliResult {
  readonly stdout: string;
  readonly stderr: string;
}

function getPrismaCliPath(): string {
  return require.resolve('prisma/build/index.js');
}

function runPrismaCli(
  args: readonly string[],
  options: { readonly cwd?: string },
): Promise<PrismaCliResult> {
  return new Promise((resolvePromise, reject) => {
    const prismaCliPath = getPrismaCliPath();
    const child = spawn(process.execPath, [prismaCliPath, ...args], {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }

      const combined = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
      reject(
        new Error(
          combined.length > 0
            ? combined
            : `Prisma CLI failed with exit code ${String(code ?? 'unknown')}`,
        ),
      );
    });
  });
}

function extractPrintedSchema(stdout: string, stderr: string): string {
  const trimmed = stdout.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }

  // Fallback for environments where the schema is emitted to stderr.
  const fromStderr = stderr
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(
      (line) =>
        line.includes('model ') || line.includes('datasource ') || line.includes('generator '),
    )
    .join('\n')
    .trim();
  return fromStderr;
}

async function prepareSchemaForPrismaCli(
  schemaPath: string,
): Promise<{ readonly schemaPath: string; readonly cleanup: () => Promise<void> }> {
  const absolutePath = resolve(schemaPath);
  const schema = await readFile(absolutePath, 'utf8');
  const sanitized = sanitizePrismaSchemaForPrisma7(schema);

  if (sanitized === schema) {
    return {
      schemaPath: absolutePath,
      cleanup: async () => {},
    };
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'prisma-next-prisma-schema-'));
  const tempPath = join(tempDir, 'schema.prisma');
  await writeFile(tempPath, sanitized, 'utf8');

  return {
    schemaPath: tempPath,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}
