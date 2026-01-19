import type { Brand } from '@prisma-next/contract/types';
import type { SqlContract } from '@prisma-next/sql-contract/types';
import type { ColumnReference } from './column-reference';
import type { TableReference } from './table-reference';
import type { ErrorMessage } from './type-errors';

export type Ref<TContract extends SqlContract> = {
  readonly [TableName in keyof TContract['storage']['tables'] & string]: TableReference<
    TableName,
    TContract['coreHash']
  > & {
    readonly [ColumnName in Exclude<
      keyof TContract['storage']['tables'][TableName]['columns'],
      keyof TableReference
    > &
      string]: ColumnReference<ColumnName, TableName, TContract['coreHash']>;
  } & Record<
      PropertyKey,
      ColumnReferenceOutOfContractError<`[error] reference to a non-existing column in the '${TableName}' table`>
    >;
} & Record<
  PropertyKey,
  TableReferenceOutOfContractError<`[error] reference to a non-existing table in the contract`>
>;

/**
 * An error type indicating that the provided table reference is out of the contract's scope.
 * To be used in reference creators, e.g. `createRef()`.
 *
 * @template TMessage The error message.
 */
export type TableReferenceOutOfContractError<TMessage extends ErrorMessage> = Brand<TMessage>;

/**
 * An error type indicating that the provided column reference is out of the contract's scope.
 * To be used in reference creators, e.g. `createRef()`.
 *
 * @template TMessage The error message.
 */
export type ColumnReferenceOutOfContractError<TMessage extends ErrorMessage> = Brand<TMessage>;

/**
 * Creates a reference object for the given SQL contract.
 */
export function createRef<TContract extends SqlContract>(_contract: TContract): Ref<TContract> {
  return new Proxy({} as Ref<TContract>, {
    get(_target, tableName) {
      return new Proxy(Object.freeze({ '~name': tableName }), {
        get(_target, columnName) {
          if (columnName === '~name') {
            return tableName;
          }

          return Object.freeze({
            '~name': columnName,
            '~table': tableName,
          });
        },
      });
    },
  });
}
