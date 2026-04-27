import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import type { SqlDriver } from '@prisma-next/sql-relational-core/ast';
import { type CreateRuntimeOptions, createRuntime, type Runtime } from '@prisma-next/sql-runtime';
import { db } from '../../src/prisma/db';

const context = db.context;
const executionStack = db.stack;

export async function createTestDriver(databasePath: string) {
  const stackInstance = instantiateExecutionStack(
    executionStack,
  ) as CreateRuntimeOptions['stackInstance'];
  const driver = stackInstance.driver as unknown as SqlDriver<{
    readonly kind: 'path';
    readonly path: string;
  }>;
  if (!driver) {
    throw new Error('Driver descriptor missing from execution stack');
  }
  await driver.connect({ kind: 'path', path: databasePath });
  return { stackInstance, driver };
}

export async function getRuntime(databasePath: string): Promise<Runtime> {
  const { stackInstance, driver } = await createTestDriver(databasePath);
  return createRuntime({
    stackInstance,
    context,
    driver,
    verify: { mode: 'onFirstUse', requireMarker: false },
  });
}

export interface TempDatabase {
  readonly databasePath: string;
  cleanup(): void;
}

export function createTempDatabase(): TempDatabase {
  const dir = mkdtempSync(join(tmpdir(), 'prisma-next-demo-sqlite-'));
  const databasePath = join(dir, 'test.db');
  return {
    databasePath,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
