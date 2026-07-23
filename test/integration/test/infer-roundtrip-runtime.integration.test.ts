/**
 * Infer -> Emit Round-Trip Fidelity — runtime half (TML-3037).
 *
 * `cli-journeys/infer-roundtrip-fidelity.e2e.test.ts` drives infer -> emit ->
 * `db verify --schema-only`, but neither `contract emit` nor `db verify`
 * builds an `ExecutionContext` — codec parameterization and decode behavior
 * are only observable here. Each scenario infers + emits a real contract from
 * a live database, then builds a real `ExecutionContext`/runtime against it
 * (`createDevDatabase`, a real driver, no CLI mocking).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import type { Contract } from '@prisma-next/contract/types';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import { PostgresRuntimeImpl } from '@prisma-next/postgres/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { Collection } from '@prisma-next/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@prisma-next/target-postgres/runtime';
import { createDevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import { Client } from 'pg';
import stripAnsi from 'strip-ansi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTempDir } from './utils/cli-test-helpers';
import {
  type JourneyContext,
  runContractEmit,
  runContractInfer,
  setupJourney,
} from './utils/journey-test-helpers';

function readEmittedContract(ctx: JourneyContext): Contract<SqlStorage> {
  // The db-connected PSL journey config emits `contract.json` at the test
  // dir root (not under `ctx.outputDir`) — same path native-enum-adoption's
  // `readEmittedContractJson` reads from.
  const raw: unknown = JSON.parse(readFileSync(join(ctx.testDir, 'contract.json'), 'utf-8'));
  return new PostgresContractSerializer().deserializeContract(raw);
}

async function inferAndEmit(
  connectionString: string,
  createTempDir: () => string,
): Promise<JourneyContext> {
  const ctx: JourneyContext = setupJourney({
    connectionString,
    createTempDir,
    contractMode: 'psl',
  });
  const infer = await runContractInfer(ctx);
  if (infer.exitCode !== 0) {
    throw new Error(`contract infer failed:\n${stripAnsi(infer.stderr)}`);
  }
  const emit = await runContractEmit(ctx);
  if (emit.exitCode !== 0) {
    throw new Error(`contract emit failed:\n${stripAnsi(emit.stderr)}\n${stripAnsi(emit.stdout)}`);
  }
  return ctx;
}

withTempDir(({ createTempDir }) => {
  describe('Runtime: unbounded numeric crashes ExecutionContext construction', () => {
    let database: Awaited<ReturnType<typeof createDevDatabase>>;

    beforeAll(async () => {
      database = await createDevDatabase();
      await withClient(database.connectionString, (client) =>
        client.query(`
          CREATE TABLE amount_probe (
            id int4 PRIMARY KEY,
            amount numeric
          );
        `),
      );
    }, timeouts.spinUpPpgDev);

    afterAll(async () => {
      if (database) await database.close();
    }, timeouts.spinUpPpgDev);

    it(
      'an unbounded numeric column emits cleanly and builds an ExecutionContext',
      async () => {
        const ctx = await inferAndEmit(database.connectionString, createTempDir);
        const contract = readEmittedContract(ctx);

        let constructionError: unknown;
        try {
          createExecutionContext({
            contract,
            stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
          });
        } catch (error) {
          constructionError = error;
        }
        expect(
          constructionError,
          'createExecutionContext should accept an unbounded numeric column',
        ).toBeUndefined();
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Runtime: a hand-authored bare Decimal field builds an ExecutionContext', () => {
    let database: Awaited<ReturnType<typeof createDevDatabase>>;

    beforeAll(async () => {
      database = await createDevDatabase();
    }, timeouts.spinUpPpgDev);

    afterAll(async () => {
      if (database) await database.close();
    }, timeouts.spinUpPpgDev);

    it(
      '"amount Decimal" with no @db.Numeric attribute emits cleanly and builds an ExecutionContext',
      async () => {
        // Hand-authored, not inferred: `control-mutation-defaults.ts` maps
        // the bare `Decimal` scalar straight to `pg/numeric@1` with no
        // `typeParams`, independent of any `@db.Numeric` attribute — the same
        // base-scalar path the unbounded-numeric scenario above reaches
        // indirectly, exercised here without infer in the loop.
        const ctx: JourneyContext = setupJourney({
          connectionString: database.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        writeFileSync(
          join(ctx.testDir, 'contract.prisma'),
          [
            '// use prisma-next',
            '',
            'model AmountProbe {',
            '  id     Int     @id',
            '  amount Decimal',
            '',
            '  @@map("amount_probe")',
            '}',
            '',
          ].join('\n'),
        );

        const emit = await runContractEmit(ctx);
        if (emit.exitCode !== 0) {
          throw new Error(
            `contract emit failed:\n${stripAnsi(emit.stderr)}\n${stripAnsi(emit.stdout)}`,
          );
        }
        const contract = readEmittedContract(ctx);

        let constructionError: unknown;
        try {
          createExecutionContext({
            contract,
            stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
          });
        } catch (error) {
          constructionError = error;
        }
        expect(
          constructionError,
          'createExecutionContext should accept a bare Decimal field',
        ).toBeUndefined();
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Runtime: date columns — top-level select works, include() decode stays broken until @db.Date binds to pg/date@1', () => {
    let database: Awaited<ReturnType<typeof createDevDatabase>>;

    beforeAll(async () => {
      database = await createDevDatabase();
      await withClient(database.connectionString, (client) =>
        client.query(`
          CREATE TABLE owner (
            id int4 PRIMARY KEY
          );
          CREATE TABLE record (
            id int4 PRIMARY KEY,
            owner_id int4 NOT NULL REFERENCES owner(id),
            noted_on date NOT NULL
          );
          INSERT INTO owner (id) VALUES (1);
          INSERT INTO record (id, owner_id, noted_on) VALUES (1, 1, '2024-01-15');
        `),
      );
    }, timeouts.spinUpPpgDev);

    afterAll(async () => {
      if (database) await database.close();
    }, timeouts.spinUpPpgDev);

    it(
      'top-level select decodes the date; include() rejects the same column (known gap)',
      async () => {
        const ctx = await inferAndEmit(database.connectionString, createTempDir);
        const contract = readEmittedContract(ctx);

        const stack = createSqlExecutionStack({
          target: postgresTarget,
          adapter: postgresAdapter,
          driver: postgresDriver,
        });
        const context = createExecutionContext({ contract, stack });
        const stackInstance = instantiateExecutionStack(stack);
        const adapter = stackInstance.adapter;
        const driver = stackInstance.driver;
        if (!adapter || !driver) {
          throw new Error('Adapter or driver descriptor missing from execution stack');
        }

        const client = new Client({ connectionString: database.connectionString });
        await client.connect();
        try {
          await driver.connect({ kind: 'pgClient', client });
          const runtime = new PostgresRuntimeImpl({ context, adapter, driver });
          try {
            const records = new Collection({ runtime, context }, 'Record', {
              namespaceId: 'public',
            });
            const [row] = await records.select('id', 'notedOn').all();
            // `@db.Date` inherits `pg/timestamptz@1`, whose decode() passes
            // through the driver's local-midnight `Date` — only the calendar
            // date is stable across process timezones, so assert via local
            // getters, not an exact instant.
            const notedOn = row?.notedOn;
            expect(notedOn, 'top-level select decodes a Date').toBeInstanceOf(Date);
            const decoded = notedOn as Date;
            expect(
              [decoded.getFullYear(), decoded.getMonth(), decoded.getDate()],
              'top-level select decodes the right calendar date',
            ).toEqual([2024, 0, 15]);

            const owners = new Collection({ runtime, context }, 'Owner', {
              namespaceId: 'public',
            });
            let includeResult: unknown;
            let includeError: unknown;
            try {
              includeResult = await owners
                .select('id')
                // `contract` is a dynamically-introspected `Contract<SqlStorage>`
                // with no literal domain shape (it doesn't exist until this test
                // runs infer + emit), so `include`'s relation-name type inference
                // has nothing to key off; test files are exempt from the
                // no-bare-casts rule.
                .include('records' as never, (record) => record.select('notedOn'))
                .all();
            } catch (error) {
              includeError = error;
            }
            // Pins the gap: `pg/timestamptz@1.decodeJson` rejects the bare
            // `YYYY-MM-DD` that `json_agg` renders. Binding the date spelling to
            // `pg/date@1` flips this — then assert
            // [{ id: 1, records: [{ notedOn: new Date(Date.UTC(2024, 0, 15)) }] }].
            expect(includeResult, 'include() must not silently return a value').toBeUndefined();
            expect(includeError, 'include() rejects the date column today').toMatchObject({
              code: 'RUNTIME.DECODE_FAILED',
            });
          } finally {
            await runtime.close();
          }
        } finally {
          await client.end();
        }
      },
      timeouts.spinUpPpgDev,
    );
  });
});
