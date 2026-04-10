import type { SqlControlAdapterDescriptor } from '@prisma-next/family-sql/control';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import { SqliteControlAdapter } from '../core/control-adapter';
import {
  createSqliteDefaultFunctionRegistry,
  createSqliteMutationDefaultGeneratorDescriptors,
  createSqlitePslScalarTypeDescriptors,
} from '../core/control-mutation-defaults';
import { sqliteAdapterDescriptorMeta } from '../core/descriptor-meta';
import { escapeLiteral, quoteIdentifier, SqlEscapeError } from '../core/sql-utils';

const sqliteAdapterDescriptor: SqlControlAdapterDescriptor<'sqlite'> = {
  ...sqliteAdapterDescriptorMeta,
  pslTypeDescriptors: () => ({
    scalarTypeDescriptors: createSqlitePslScalarTypeDescriptors(),
  }),
  controlMutationDefaults: () => ({
    defaultFunctionRegistry: createSqliteDefaultFunctionRegistry(),
    generatorDescriptors: createSqliteMutationDefaultGeneratorDescriptors(),
  }),
  create(): SqlControlAdapter<'sqlite'> {
    return new SqliteControlAdapter();
  },
};

export default sqliteAdapterDescriptor;

export {
  normalizeSqliteNativeType,
  parseSqliteDefault,
  SqliteControlAdapter,
} from '../core/control-adapter';
export { escapeLiteral, quoteIdentifier, SqlEscapeError };
