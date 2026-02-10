import type { SqlContract } from '@prisma-next/sql-contract/types';
import type {
  Asterisk,
  ColumnReference,
  ColumnReferenceOutOfContractError,
  TableAsterisk,
} from './column-reference';
import type { TableReference, TableReferenceOutOfContractError } from './table-reference';

/**
 * A fluent API representing references to tables and columns in a SQL contract.
 *
 * @template TContract The contract that describes the database.
 */
export type Ref<TContract extends SqlContract> = {
  readonly [TableName in keyof TContract['storage']['tables'] & string]: TableReference<
    TableName,
    TContract['storageHash']
  > & {
    readonly [ColumnName in Exclude<
      keyof TContract['storage']['tables'][TableName]['columns'],
      keyof TableReference
    > &
      string]: ColumnReference<ColumnName, TableName, TContract['storageHash']>;
  } & {
    readonly ['*']: TableAsterisk<TableName, TContract['storageHash']>;
  } & Record<
      PropertyKey,
      ColumnReferenceOutOfContractError<`[error] reference to a non-existing column in the '${TableName}' table`>
    >;
} & {
  readonly ['*']: Asterisk;
} & Record<
    PropertyKey,
    TableReferenceOutOfContractError<`[error] reference to a non-existing table in the contract`>
  >;

/**
 * Creates a reference object for the given SQL contract.
 *
 * @template TContract The contract that describes the database.
 */
export function createRef<TContract extends SqlContract>(_contract: TContract): Ref<TContract> {
  return new Proxy({} as Ref<TContract>, {
    get(_target, tableName) {
      if (tableName === '*') {
        return Object.freeze({
          '~name': tableName,
          '~table': null,
        });
      }

      return new Proxy(
        {},
        {
          get(_target, columnName) {
            if (columnName === '~name') {
              return tableName;
            }

            return Object.freeze({
              '~name': columnName,
              '~table': tableName,
            });
          },
        },
      );
    },
  });
}
