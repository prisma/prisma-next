// Shared fixture wiring for the ported data-type round-trip / typed-filter
// tests (`ported-datatypes.test.ts`, `ported-datatypes-params.test.ts`).
//
// The data-types PSL fixture authors `DataRow` (`data_rows`, one column per
// postgres scalar codec), plus `ParamRow` (`param_rows`, a parameterized
// numeric(20,8) `amount` and char(12) `code`), `BytesRow` (`bytes_rows`, a
// bytea primary key), and the `BigParent`/`BigChild` pair (`big_parents` /
// `big_children`, int8 id + fk, related 1:N). The emitted contract carries
// the `returning` capability, so `create()`/`upsert()` read the row straight
// back.
//
// Deserializing the emitted JSON runs the full sql contract validation
// pipeline (structure + domain + storage semantics), so a contract that
// failed to round-trip validation would throw here at module load.

import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import pgvectorRuntime from '@prisma-next/extension-pgvector/runtime';
import { Collection } from '@prisma-next/sql-orm-client';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@prisma-next/target-postgres/runtime';
import type { Contract as DataTypesContract } from './fixtures/datatypes-psl/generated/contract';
import dataTypesContractJson from './fixtures/datatypes-psl/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withCollectionRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

export { timeouts };

const dataTypesContract = new PostgresContractSerializer().deserializeContract<DataTypesContract>(
  dataTypesContractJson,
);

export const dataTypesContext: ExecutionContext<DataTypesContract> = createExecutionContext({
  contract: dataTypesContract,
  stack: createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    extensionPacks: [pgvectorRuntime],
  }),
});

export function createDataRowCollection(runtime: PgIntegrationRuntime) {
  return new Collection({ runtime, context: dataTypesContext }, 'DataRow', {
    namespaceId: 'public',
  });
}

export function createParamRowCollection(runtime: PgIntegrationRuntime) {
  return new Collection({ runtime, context: dataTypesContext }, 'ParamRow', {
    namespaceId: 'public',
  });
}

export function createBytesRowCollection(runtime: PgIntegrationRuntime) {
  return new Collection({ runtime, context: dataTypesContext }, 'BytesRow', {
    namespaceId: 'public',
  });
}

export function createBigParentCollection(runtime: PgIntegrationRuntime) {
  return new Collection({ runtime, context: dataTypesContext }, 'BigParent', {
    namespaceId: 'public',
  });
}

export function createBigChildCollection(runtime: PgIntegrationRuntime) {
  return new Collection({ runtime, context: dataTypesContext }, 'BigChild', {
    namespaceId: 'public',
  });
}

// `withCollectionRuntime` already runs `setupTestSchema` (base tables) and
// builds the runtime against the contract passed as its second argument, so
// the data-types contract is threaded through as `contractOverride` — every
// plan's storageHash then validates against it. `data_rows` isn't part of the
// base schema, so it's (re)created here for isolation before handing control
// to the test body. The dev database is reused across `withDevDatabase`
// invocations, hence the explicit drop.
export async function withDataRowRuntime(
  fn: (runtime: PgIntegrationRuntime) => Promise<void>,
): Promise<void> {
  await withCollectionRuntime(async (runtime) => {
    // Drop children before parents so the big_children -> big_parents FK
    // never blocks a drop; create parents before children for the same reason.
    await runtime.query('drop table if exists data_rows');
    await runtime.query('drop table if exists param_rows');
    await runtime.query('drop table if exists bytes_rows');
    await runtime.query('drop table if exists big_children');
    await runtime.query('drop table if exists big_parents');
    await runtime.query(
      `create table if not exists data_rows (
        id integer primary key,
        big_value bigint,
        float_value double precision,
        bool_value boolean,
        bytes_value bytea,
        date_time_value timestamptz,
        string_value text,
        grade text
      )`,
    );
    await runtime.query(
      `create table if not exists param_rows (
        id integer primary key,
        amount numeric(20, 8),
        code character(12)
      )`,
    );
    await runtime.query(
      `create table if not exists bytes_rows (
        id bytea primary key,
        label text
      )`,
    );
    await runtime.query(
      `create table if not exists big_parents (
        id bigint primary key,
        label text
      )`,
    );
    await runtime.query(
      `create table if not exists big_children (
        id integer primary key,
        parent_id bigint not null references big_parents(id)
      )`,
    );
    await fn(runtime);
  }, dataTypesContract);
}
