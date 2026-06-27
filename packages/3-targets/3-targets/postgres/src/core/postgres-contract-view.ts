import type { Contract } from '@prisma-next/contract/types';
import {
  buildSqlSchemaQualifiedView,
  type SqlSchemaQualifiedView,
} from '@prisma-next/sql-contract/contract-view';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { PostgresContractSerializer } from './postgres-contract-serializer';

/**
 * A schema-qualified Postgres contract view: the deserialized contract
 * intersected with per-schema accessors. It is substitutable for `Contract`
 * (carries `storage`, `domain`, …) and also exposes each schema's entities:
 *
 * ```ts
 * const view = PostgresContractView.fromJson<Contract>(contractJson);
 * view.public.table.users      // typed table leaf in the public schema
 * view.auth.table.users        // the auth schema's own users table
 * view.public.entries.policy.X // pack-contributed kind (RLS / #771 path)
 * view.__unbound__.table.X     // default schema, keyed by its raw id
 * view.storage                 // the full contract is still present
 * ```
 *
 * The schema keys mirror the facade's `sql.<ns>` keying exactly — the default
 * schema is reachable under its literal `__unbound__` id, with no renaming.
 * Each schema is its own key; there is no flat cross-namespace merge.
 */
export type PostgresContractView<TContract extends Contract<SqlStorage> = Contract<SqlStorage>> =
  SqlSchemaQualifiedView<TContract>;

export const PostgresContractView = {
  /** Wrap an already-deserialized Postgres contract in a schema-qualified view. */
  from<TContract extends Contract<SqlStorage>>(
    contract: TContract,
  ): PostgresContractView<TContract> {
    return buildSqlSchemaQualifiedView(contract);
  },

  /** Deserialize a Postgres contract JSON envelope and wrap it in a view. */
  fromJson<TContract extends Contract<SqlStorage> = Contract<SqlStorage>>(
    json: unknown,
  ): PostgresContractView<TContract> {
    const contract = new PostgresContractSerializer().deserializeContract<TContract>(json);
    return buildSqlSchemaQualifiedView(contract);
  },
};
