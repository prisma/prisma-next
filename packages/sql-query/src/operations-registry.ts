import type { OperationRegistry, StorageColumn } from '@prisma-next/sql-target';
import { planInvalid } from './errors';
import type {
  ColumnBuilder,
  ColumnBuilderBase,
  ColumnRef,
  LiteralExpr,
  OperationExpr,
  OperationTypes,
  ParamPlaceholder,
  ParamRef,
} from './types';

export function attachOperationsToColumnBuilder<
  ColumnName extends string,
  ColumnMeta extends StorageColumn,
  JsType = unknown,
  Operations extends OperationTypes = Record<string, never>,
>(
  columnBuilder: ColumnBuilderBase<ColumnName, ColumnMeta, JsType>,
  columnMeta: ColumnMeta,
  registry: OperationRegistry | undefined,
  contractCapabilities?: Record<string, Record<string, boolean>>,
): ColumnBuilder<ColumnName, ColumnMeta, JsType, Operations> {
  if (!registry) {
    return columnBuilder as ColumnBuilder<ColumnName, ColumnMeta, JsType, Operations>;
  }

  const typeId = columnMeta.type;

  const operations = registry.byType(typeId);
  if (operations.length === 0) {
    return columnBuilder as ColumnBuilder<ColumnName, ColumnMeta, JsType, Operations>;
  }

  const builderWithOps = columnBuilder as unknown as ColumnBuilder<
    ColumnName,
    ColumnMeta,
    JsType,
    Operations
  > & {
    [method: string]: (...args: unknown[]) => ColumnBuilder<string, StorageColumn, unknown>;
  };

  for (const operation of operations) {
    if (operation.capabilities && operation.capabilities.length > 0) {
      if (!contractCapabilities) {
        continue;
      }

      const hasAllCapabilities = operation.capabilities.every((cap) => {
        const [namespace, ...rest] = cap.split('.');
        const key = rest.join('.');
        const namespaceCaps = namespace ? contractCapabilities[namespace] : undefined;
        return namespaceCaps?.[key] === true;
      });

      if (!hasAllCapabilities) {
        continue;
      }
    }
    (builderWithOps as Record<string, unknown>)[operation.method] = function (
      this: ColumnBuilderBase<ColumnName, ColumnMeta, JsType>,
      ...args: unknown[]
    ) {
      if (args.length !== operation.args.length) {
        throw planInvalid(
          `Operation ${operation.method} expects ${operation.args.length} arguments, got ${args.length}`,
        );
      }

      const selfRef: ColumnRef = {
        kind: 'col',
        table: this.table,
        column: this.column,
      };

      const operationArgs: Array<ColumnRef | ParamRef | LiteralExpr> = [];
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const argSpec = operation.args[i];
        if (!argSpec) {
          throw planInvalid(`Missing argument spec for argument ${i}`);
        }

        if (argSpec.kind === 'param') {
          if (
            !arg ||
            typeof arg !== 'object' ||
            !('kind' in arg) ||
            arg.kind !== 'param-placeholder' ||
            !('name' in arg)
          ) {
            throw planInvalid(`Argument ${i} must be a parameter placeholder`);
          }
          operationArgs.push({
            kind: 'param',
            index: 0,
            name: (arg as ParamPlaceholder).name,
          });
        } else if (argSpec.kind === 'typeId') {
          if (!arg || typeof arg !== 'object' || !('kind' in arg)) {
            throw planInvalid(`Argument ${i} must be a ColumnBuilder`);
          }
          const colBuilder = arg as ColumnBuilder<string, StorageColumn, unknown>;
          operationArgs.push({
            kind: 'col',
            table: colBuilder.table,
            column: colBuilder.column,
          });
        } else if (argSpec.kind === 'literal') {
          operationArgs.push({
            kind: 'literal',
            value: arg,
          });
        }
      }

      const operationExpr: OperationExpr = {
        kind: 'operation',
        method: operation.method,
        forTypeId: operation.forTypeId,
        self: selfRef,
        args: operationArgs,
        returns: operation.returns,
        lowering: operation.lowering,
      };

      const returnTypeId = operation.returns.kind === 'typeId' ? operation.returns.type : undefined;
      const returnColumnMeta: StorageColumn = returnTypeId
        ? {
            ...columnMeta,
            type: returnTypeId,
          }
        : columnMeta;

      const result = Object.freeze({
        kind: 'column' as const,
        table: this.table,
        column: this.column,
        get columnMeta() {
          return returnColumnMeta;
        },
        eq(value: ParamPlaceholder) {
          return Object.freeze({
            kind: 'binary' as const,
            op: 'eq' as const,
            left: operationExpr,
            right: value,
          });
        },
        asc() {
          return Object.freeze({
            kind: 'order' as const,
            expr: operationExpr,
            dir: 'asc' as const,
          });
        },
        desc() {
          return Object.freeze({
            kind: 'order' as const,
            expr: operationExpr,
            dir: 'desc' as const,
          });
        },
        _operationExpr: operationExpr,
      }) as unknown as ColumnBuilder<string, StorageColumn, unknown> & {
        _operationExpr?: OperationExpr;
      };
      return result;
    };
  }

  return builderWithOps;
}
