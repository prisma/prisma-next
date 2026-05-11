import type { Contract } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import {
  type ExecutionStackInstance,
  instantiateExecutionStack,
  type RuntimeDriverInstance,
  type RuntimeExtensionInstance,
} from '@prisma-next/framework-components/execution';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { Codec, SqlDriver, SqlExecuteRequest } from '@prisma-next/sql-relational-core/ast';
import { SelectAst, TableSource } from '@prisma-next/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@prisma-next/sql-relational-core/plan';
import { describe, expect, it, vi } from 'vitest';
import { parseContractMarkerRow } from '../src/marker';
import type {
  SqlRuntimeAdapterDescriptor,
  SqlRuntimeAdapterInstance,
  SqlRuntimeTargetDescriptor,
} from '../src/sql-context';
import { createExecutionContext, createSqlExecutionStack } from '../src/sql-context';
import { createRuntime } from '../src/sql-runtime';
import { defineTestCodec } from './test-codec';
import { descriptorsFromCodecs } from './utils';

/**
 * Pins the per-error-class branches of `verifyMarker` in `sql-runtime.ts`: missing marker (with `requireMarker: true`), missing marker tolerated (with `requireMarker: false`), and profile-hash mismatch. Storage-hash mismatch is covered by `marker-vs-intercept-ordering.test.ts`.
 */

const testContract: Contract<SqlStorage> = {
  targetFamily: 'sql',
  target: 'postgres',
  profileHash: profileHash('sha256:test-profile'),
  models: {},
  roots: {},
  storage: { storageHash: coreHash('sha256:test'), tables: {} },
  extensionPacks: {},
  capabilities: {},
  meta: {},
};

function createCodecs(): ReadonlyArray<Codec<string>> {
  return [
    defineTestCodec({
      typeId: 'pg/int4@1',
      targetTypes: ['int4'],
      encode: (v: number) => v,
      decode: (w: number) => w,
    }),
  ];
}

function createStubAdapter(codecs: ReadonlyArray<Codec<string>>) {
  return {
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    profile: {
      id: 'test-profile',
      target: 'postgres',
      capabilities: {},
      codecs() {
        return codecs;
      },
      markerExistsStatement() {
        return { sql: 'select 1 from information_schema.tables', params: [] };
      },
      readMarkerStatement() {
        return { sql: 'select * from prisma_contract.marker', params: [1] };
      },
      parseMarkerRow: parseContractMarkerRow,
    },
    lower(ast: SelectAst) {
      return Object.freeze({ sql: JSON.stringify(ast), params: [] });
    },
  };
}

interface MarkerRow {
  readonly core_hash: string;
  readonly profile_hash: string;
  readonly contract_json: null;
  readonly canonical_version: number;
  readonly updated_at: Date;
  readonly app_tag: null;
  readonly meta: null;
  readonly invariants: readonly never[];
}

function createDriver(rows: readonly MarkerRow[]): SqlDriver {
  const query = vi.fn().mockResolvedValue({ rows, rowCount: rows.length });
  const execute = vi.fn().mockImplementation(async function* (_request: SqlExecuteRequest) {
    yield {} as Record<string, unknown>;
  });
  return {
    execute,
    query,
    connect: vi.fn().mockImplementation(async (_binding?: undefined) => undefined),
    acquireConnection: vi.fn().mockRejectedValue(new Error('not used in this test')),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createTargetDescriptor(): SqlRuntimeTargetDescriptor<'postgres'> {
  return {
    kind: 'target',
    id: 'postgres',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => [],
    create() {
      return { familyId: 'sql' as const, targetId: 'postgres' as const };
    },
  };
}

function createAdapterDescriptor(
  adapter: ReturnType<typeof createStubAdapter>,
): SqlRuntimeAdapterDescriptor<'postgres'> {
  const descriptors = descriptorsFromCodecs(adapter.profile.codecs());
  return {
    kind: 'adapter',
    id: 'test-adapter',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => descriptors,
    create() {
      return Object.assign(
        { familyId: 'sql' as const, targetId: 'postgres' as const },
        adapter,
      ) as SqlRuntimeAdapterInstance<'postgres'>;
    },
  };
}

function createSetup(driver: SqlDriver, requireMarker: boolean) {
  const codecs = createCodecs();
  const adapter = createStubAdapter(codecs);
  const target = createTargetDescriptor();
  const adapterDesc = createAdapterDescriptor(adapter);
  const stack = createSqlExecutionStack({
    target,
    adapter: adapterDesc,
    extensionPacks: [],
  });
  type SqlTestStackInstance = ExecutionStackInstance<
    'sql',
    'postgres',
    SqlRuntimeAdapterInstance<'postgres'>,
    RuntimeDriverInstance<'sql', 'postgres'>,
    RuntimeExtensionInstance<'sql', 'postgres'>
  >;
  const stackInstance = instantiateExecutionStack(stack) as SqlTestStackInstance;
  const context = createExecutionContext({
    contract: testContract,
    stack: { target, adapter: adapterDesc, extensionPacks: [] },
  });
  return createRuntime({
    stackInstance,
    context,
    driver,
    verify: { mode: 'always', requireMarker },
  });
}

function createPlan(): SqlExecutionPlan {
  const ast = SelectAst.from(TableSource.named('users'));
  return {
    sql: 'select * from users',
    params: [],
    ast,
    meta: {
      target: testContract.target,
      targetFamily: testContract.targetFamily,
      storageHash: testContract.storage.storageHash,
      lane: 'raw',
    },
  };
}

function createStartupSetup(driver: SqlDriver) {
  const codecs = createCodecs();
  const adapter = createStubAdapter(codecs);
  const target = createTargetDescriptor();
  const adapterDesc = createAdapterDescriptor(adapter);
  const stack = createSqlExecutionStack({
    target,
    adapter: adapterDesc,
    extensionPacks: [],
  });
  type SqlTestStackInstance = ExecutionStackInstance<
    'sql',
    'postgres',
    SqlRuntimeAdapterInstance<'postgres'>,
    RuntimeDriverInstance<'sql', 'postgres'>,
    RuntimeExtensionInstance<'sql', 'postgres'>
  >;
  const stackInstance = instantiateExecutionStack(stack) as SqlTestStackInstance;
  const context = createExecutionContext({
    contract: testContract,
    stack: { target, adapter: adapterDesc, extensionPacks: [] },
  });
  return createRuntime({
    stackInstance,
    context,
    driver,
    verify: { mode: 'startup', requireMarker: false },
  });
}

describe('verifyMarker', () => {
  it('throws CONTRACT.MARKER_MISSING when no marker row exists and requireMarker is true', async () => {
    const runtime = createSetup(createDriver([]), true);

    await expect(runtime.execute(createPlan()).toArray()).rejects.toMatchObject({
      code: 'CONTRACT.MARKER_MISSING',
      category: 'CONTRACT',
    });
  });

  it('runs verification on first execute when mode is "startup"', async () => {
    const driver = createDriver([
      {
        core_hash: 'sha256:test',
        profile_hash: 'sha256:test-profile',
        contract_json: null,
        canonical_version: 1,
        updated_at: new Date('2026-01-01T00:00:00Z'),
        app_tag: null,
        meta: null,
        invariants: [],
      },
    ]);
    const runtime = createStartupSetup(driver);

    await runtime.execute(createPlan()).toArray();
    const callsAfterFirst = driver.query.mock.calls.length;
    await runtime.execute(createPlan()).toArray();
    const callsAfterSecond = driver.query.mock.calls.length;

    expect(callsAfterFirst).toBeGreaterThan(0);
    expect(callsAfterSecond).toBe(callsAfterFirst);
  });

  it('skips verification when no marker row exists and requireMarker is false', async () => {
    const runtime = createSetup(createDriver([]), false);

    const rows = await runtime.execute(createPlan()).toArray();
    expect(rows).toBeDefined();
  });

  it('passes verification when marker matches contract storage and profile hash', async () => {
    const driver = createDriver([
      {
        core_hash: 'sha256:test',
        profile_hash: 'sha256:test-profile',
        contract_json: null,
        canonical_version: 1,
        updated_at: new Date('2026-01-01T00:00:00Z'),
        app_tag: null,
        meta: null,
        invariants: [],
      },
    ]);
    const runtime = createSetup(driver, true);

    const rows = await runtime.execute(createPlan()).toArray();
    expect(rows).toBeDefined();
  });

  it('throws CONTRACT.MARKER_MISMATCH when the database profile hash differs from the contract', async () => {
    const driver = createDriver([
      {
        core_hash: 'sha256:test',
        profile_hash: 'sha256:other-profile',
        contract_json: null,
        canonical_version: 1,
        updated_at: new Date('2026-01-01T00:00:00Z'),
        app_tag: null,
        meta: null,
        invariants: [],
      },
    ]);
    const runtime = createSetup(driver, true);

    await expect(runtime.execute(createPlan()).toArray()).rejects.toMatchObject({
      code: 'CONTRACT.MARKER_MISMATCH',
      details: expect.objectContaining({
        expectedProfile: 'sha256:test-profile',
        actualProfile: 'sha256:other-profile',
      }),
    });
  });
});
