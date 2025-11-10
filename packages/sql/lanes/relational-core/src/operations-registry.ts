import type { OperationRegistry } from '@prisma-next/operations';
import { hasAllCapabilities } from '@prisma-next/operations';
import { planInvalid } from '@prisma-next/plan';
import type { StorageColumn } from '@prisma-next/sql-contract-types';
import type { OperationSignature } from '@prisma-next/sql-operations';
import type { ColumnRef, LiteralExpr, OperationExpr, ParamRef } from '@prisma-next/sql-target';
import type { AnyColumnBuilder, ColumnBuilder, OperationTypes, ParamPlaceholder } from './types';

function isParamPlaceholder(value: unknown): value is ParamPlaceholder {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'param-placeholder' &&
    'name' in value &&
    typeof (value as { name: unknown }).name === 'string'
  );
}

function isColumnBuilder(value: unknown): value is AnyColumnBuilder {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'column'
  );
}

/**
 * Executes an operation and returns a column-shaped result object.
 * This is the canonical entrypoint for operation invocation, enabling
 * future enhancements like telemetry, caching, or tracing.
 *
 * @param signature - The operation signature from the registry
 * @param selfBuilder - The column builder that the operation is called on
 * @param args - The arguments passed to the operation
 * @param columnMeta - The metadata of the column the operation is called on
 * @returns A column-shaped builder with the operation expression attached
 */
function executeOperation(
  signature: OperationSignature,
  selfBuilder: AnyColumnBuilder,
  args: unknown[],
  columnMeta: StorageColumn,
  operationRegistry?: OperationRegistry,
  contractCapabilities?: Record<string, Record<string, boolean>>,
): AnyColumnBuilder & { _operationExpr?: OperationExpr } {
  if (args.length !== signature.args.length) {
    throw planInvalid(
      `Operation ${signature.method} expects ${signature.args.length} arguments, got ${args.length}`,
    );
  }

  // Check if this column builder has an existing operation expression
  const selfBuilderWithExpr = selfBuilder as unknown as {
    _operationExpr?: OperationExpr;
    table: string;
    column: string;
  };
  const selfExpr: ColumnRef | OperationExpr = selfBuilderWithExpr._operationExpr
    ? selfBuilderWithExpr._operationExpr
    : {
        kind: 'col',
        table: selfBuilderWithExpr.table,
        column: selfBuilderWithExpr.column,
      };

  const operationArgs: Array<ColumnRef | ParamRef | LiteralExpr | OperationExpr> = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const argSpec = signature.args[i];
    if (!argSpec) {
      throw planInvalid(`Missing argument spec for argument ${i}`);
    }

    if (argSpec.kind === 'param') {
      if (!isParamPlaceholder(arg)) {
        throw planInvalid(`Argument ${i} must be a parameter placeholder`);
      }
      operationArgs.push({
        kind: 'param',
        index: 0,
        name: arg.name,
      });
    } else if (argSpec.kind === 'typeId') {
      if (!isColumnBuilder(arg)) {
        throw planInvalid(`Argument ${i} must be a ColumnBuilder`);
      }
      const colBuilderWithExpr = arg as unknown as {
        _operationExpr?: OperationExpr;
        table: string;
        column: string;
      };
      // Check if the column builder has an operation expression
      if (colBuilderWithExpr._operationExpr) {
        operationArgs.push(colBuilderWithExpr._operationExpr);
      } else {
        // Fall back to raw ColumnRef
        operationArgs.push({
          kind: 'col',
          table: colBuilderWithExpr.table,
          column: colBuilderWithExpr.column,
        });
      }
    } else if (argSpec.kind === 'literal') {
      operationArgs.push({
        kind: 'literal',
        value: arg,
      });
    }
  }

  const operationExpr: OperationExpr = {
    kind: 'operation',
    method: signature.method,
    forTypeId: signature.forTypeId,
    self: selfExpr,
    args: operationArgs,
    returns: signature.returns,
    lowering: signature.lowering,
  };

  const returnTypeId = signature.returns.kind === 'typeId' ? signature.returns.type : undefined;
  const returnColumnMeta: StorageColumn = returnTypeId
    ? {
        ...columnMeta,
        type: returnTypeId,
      }
    : columnMeta;

  const baseResult = {
    kind: 'column' as const,
    table: selfBuilderWithExpr.table,
    column: selfBuilderWithExpr.column,
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
  } as unknown as AnyColumnBuilder & {
    _operationExpr?: OperationExpr;
  };

  // If the return type is a typeId, attach operations for that type
  if (returnTypeId && operationRegistry) {
    const resultWithOps = attachOperationsToColumnBuilder(
      baseResult as ColumnBuilder<string, StorageColumn, unknown, Record<string, never>>,
      returnColumnMeta,
      operationRegistry,
      contractCapabilities,
    ) as AnyColumnBuilder & {
      _operationExpr?: OperationExpr;
    };
    return Object.freeze(resultWithOps);
  }

  return Object.freeze(baseResult);
}

export function attachOperationsToColumnBuilder<
  ColumnName extends string,
  ColumnMeta extends StorageColumn,
  JsType = unknown,
  Operations extends OperationTypes = Record<string, never>,
>(
  columnBuilder: ColumnBuilder<ColumnName, ColumnMeta, JsType, Record<string, never>>,
  columnMeta: ColumnMeta,
  registry: OperationRegistry | undefined,
  contractCapabilities?: Record<string, Record<string, boolean>>,
): ColumnBuilder<ColumnName, ColumnMeta, JsType, Operations> {
  if (!registry) {
    return columnBuilder as ColumnBuilder<ColumnName, ColumnMeta, JsType, Operations>;
  }

  const typeId = columnMeta.type;

  const operations = registry.byType(typeId) as OperationSignature[];
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

      if (!hasAllCapabilities(operation.capabilities, contractCapabilities)) {
        continue;
      }
    }
    // Method sugar: attach operation as a method on the column builder
    (builderWithOps as Record<string, unknown>)[operation.method] = function (
      this: ColumnBuilder<ColumnName, ColumnMeta, JsType, Record<string, never>>,
      ...args: unknown[]
    ) {
      return executeOperation(
        operation,
        this as unknown as ColumnBuilder<string, StorageColumn, unknown>,
        args,
        columnMeta,
        registry,
        contractCapabilities,
      );
    };
  }

  return builderWithOps;
}
