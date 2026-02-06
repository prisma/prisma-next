import type { ControlAdapterDescriptor } from '@prisma-next/core-control-plane/types';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import { SqliteControlAdapter } from '../core/control-adapter';
import { parseSqliteDefault } from '../core/default-normalizer';
import { sqliteAdapterDescriptorMeta } from '../core/descriptor-meta';
import { escapeLiteral, qualifyName, quoteIdentifier, SqlEscapeError } from '../core/sql-utils';

/**
 * SQLite adapter descriptor for CLI config.
 */
const sqliteAdapterDescriptor: ControlAdapterDescriptor<
  'sql',
  'sqlite',
  SqlControlAdapter<'sqlite'>
> = {
  ...sqliteAdapterDescriptorMeta,
  create(): SqlControlAdapter<'sqlite'> {
    return new SqliteControlAdapter();
  },
};

export default sqliteAdapterDescriptor;

export { escapeLiteral, parseSqliteDefault, qualifyName, quoteIdentifier, SqlEscapeError };
