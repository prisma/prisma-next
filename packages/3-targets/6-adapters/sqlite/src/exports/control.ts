import type { SqlControlAdapterDescriptor } from '@prisma-next/family-sql/control';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import { SqliteControlAdapter } from '../core/control-adapter';
import {
  createSqliteDefaultFunctionRegistry,
  createSqliteMutationDefaultGeneratorDescriptors,
  createSqliteScalarTypeDescriptors,
} from '../core/control-mutation-defaults';
import { sqliteAdapterDescriptorMeta } from '../core/descriptor-meta';

const sqliteAdapterDescriptor: SqlControlAdapterDescriptor<'sqlite'> = {
  ...sqliteAdapterDescriptorMeta,
  scalarTypeDescriptors: createSqliteScalarTypeDescriptors(),
  controlMutationDefaults: {
    defaultFunctionRegistry: createSqliteDefaultFunctionRegistry(),
    generatorDescriptors: createSqliteMutationDefaultGeneratorDescriptors(),
  },
  create(): SqlControlAdapter<'sqlite'> {
    return new SqliteControlAdapter();
  },
};

export default sqliteAdapterDescriptor;

// `parseSqliteDefault`, `normalizeSqliteNativeType`, `quoteIdentifier`,
// `escapeLiteral`, and `SqlEscapeError` live target-side (one-way
// `adapter → target` edge, matching Postgres). Re-exported from the
// adapter so consumers — both internal and downstream — see the same
// adapter-shaped surface across SQL targets.
export { parseSqliteDefault } from '@prisma-next/target-sqlite/default-normalizer';
export { normalizeSqliteNativeType } from '@prisma-next/target-sqlite/native-type-normalizer';
export {
  escapeLiteral,
  quoteIdentifier,
  SqlEscapeError,
} from '@prisma-next/target-sqlite/sql-utils';

// `SqlControlAdapterDescriptor` is declared in two places in the codebase
// (`family-sql/control-adapter` and `family-sql/migrations/types`); the
// migrations-side declaration narrows `create()`'s return type to the base
// `ControlAdapterInstance`, hiding `introspect`/`readMarker`. Until that's
// reconciled upstream, downstream consumers (e2e harness, integration
// tests) need direct access to the concrete class. Mirrors how Postgres'
// own package tests import `PostgresControlAdapter` directly.
export { SqliteControlAdapter } from '../core/control-adapter';
