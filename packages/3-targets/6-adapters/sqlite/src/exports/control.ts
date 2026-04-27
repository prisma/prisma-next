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
// `escapeLiteral`, and `SqlEscapeError` live target-side now (mirroring
// Postgres's one-way adapter→target edge). Re-exported here to preserve the
// public surface that the e2e harness, demos, and downstream consumers
// already depend on.
export { parseSqliteDefault } from '@prisma-next/target-sqlite/default-normalizer';
export { normalizeSqliteNativeType } from '@prisma-next/target-sqlite/native-type-normalizer';
export {
  escapeLiteral,
  quoteIdentifier,
  SqlEscapeError,
} from '@prisma-next/target-sqlite/sql-utils';
export { SqliteControlAdapter } from '../core/control-adapter';
