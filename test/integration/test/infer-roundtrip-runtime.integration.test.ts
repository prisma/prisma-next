/**
 * Infer -> Emit Round-Trip Fidelity — runtime defects (TML-3037, dispatches D1/D4)
 *
 * `cli-journeys/infer-roundtrip-fidelity.e2e.test.ts` drives infer -> emit ->
 * `db verify --schema-only`, but neither `contract emit` nor `db verify`
 * builds an `ExecutionContext` — so two of the slice's eight defects never
 * surfaced on that path:
 *
 *  - An unbounded `numeric` column emits a valid contract, but building an
 *    `ExecutionContext` used to throw `RUNTIME.CODEC_PARAMETERIZATION_MISMATCH`
 *    (fixed by making `NumericParams.precision` optional — D4). RT.03 targets
 *    the same base-scalar path directly with a hand-authored `Decimal` field.
 *  - A `date` column decoded fine on a top-level `SELECT` (`decode()` was a
 *    passthrough over an already-parsed JS `Date`), but `.include()` went
 *    through `json_agg` -> `decodeJson()`, which rejected a bare `YYYY-MM-DD`
 *    string because `@db.Date` inherited `DateTime`'s `pg/timestamptz@1`
 *    codec (fixed by introducing `pg/date@1` — D4).
 *
 * Each scenario below infers + emits a real contract from a live database
 * (same CLI path the journey test uses), deserializes the emitted
 * `contract.json`, and builds a real `ExecutionContext`/runtime against it —
 * following the shape of `rls-ts-walking-skeleton.integration.test.ts`
 * (`createDevDatabase`, a real driver, no CLI mocking) for the runtime half.
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
      'RT.01: an unbounded numeric column emits cleanly and builds an ExecutionContext',
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
          'RT.01: createExecutionContext should accept an unbounded numeric column',
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
      'RT.03: "amount Decimal" with no @db.Numeric attribute emits cleanly and builds an ExecutionContext',
      async () => {
        // Hand-authored, not inferred: `control-mutation-defaults.ts` maps
        // the bare `Decimal` scalar straight to `pg/numeric@1` with no
        // `typeParams`, independent of any `@db.Numeric` attribute. RT.01
        // reaches this same base-scalar path indirectly (infer prints an
        // unbounded `numeric` column as a bare `Decimal?`); this test targets
        // it directly so the base-scalar fix can't regress behind an
        // infer-only test.
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
          'RT.03: createExecutionContext should accept a bare Decimal field',
        ).toBeUndefined();
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Runtime: a date column decodes on select() but fails through include()', () => {
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
      'RT.02: top-level select decodes the date; include() decode fails on the same column',
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
            // `pg/date@1`'s decode() normalizes the driver's local-midnight
            // `Date` (built by postgres-date's OID 1082 parser) into the
            // equivalent UTC-midnight instant, so the round-trip no longer
            // depends on the process's timezone — assert the exact value.
            expect(row?.notedOn, 'RT.02: top-level select decodes the exact date').toEqual(
              new Date(Date.UTC(2024, 0, 15)),
            );

            const owners = new Collection({ runtime, context }, 'Owner', {
              namespaceId: 'public',
            });
            let includeError: unknown;
            try {
              await owners
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
            expect(
              includeError,
              'RT.02: include() should decode the same date column without throwing',
            ).toBeUndefined();
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
