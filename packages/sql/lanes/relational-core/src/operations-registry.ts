import type { OperationRegistry } from '@prisma-next/operations';
import { hasAllCapabilities } from '@prisma-next/operations';
import { planInvalid } from '@prisma-next/plan';
import type { StorageColumn } from '@prisma-next/sql-contract/types';
import type { SqlOperationSignature } from '@prisma-next/sql-operations';
import type { ColumnRef, LiteralExpr, OperationExpr, ParamRef } from './ast/types';
import { createExpressionBuilder } from './expression-builder';
import type {
  AnyColumnBuilder,
  AnyExpressionBuilder,
  ColumnBuilder,
  OperationTypes,
} from './types';
import { isParamPlaceholder } from './utils/guards';

function isColumnBuilder(value: unknown): value is AnyColumnBuilder {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'column'
  );
}

function isExpressionBuilder(value: unknown): value is AnyExpressionBuilder {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'expression'
  );
}

/**
 * Extracts the expression from a ColumnBuilder or ExpressionBuilder.
 * If it's an ExpressionBuilder, returns its expr property.
 * If it's a ColumnBuilder, converts it to a ColumnRef.
 */
function extractExpression(
  builder: AnyColumnBuilder | AnyExpressionBuilder,
): ColumnRef | OperationExpr {
  if (isExpressionBuilder(builder)) {
    return builder.expr;
  }
  // It's a ColumnBuilder - extract ColumnRef
  const colBuilder = builder as { table: string; column: string };
  return {
    kind: 'col',
    table: colBuilder.table,
    column: colBuilder.column,
  };
}

/**
 * Executes an operation and returns an ExpressionBuilder.
 * This is the canonical entrypoint for operation invocation, enabling
 * future enhancements like telemetry, caching, or tracing.
 *
 * @param signature - The operation signature from the registry
 * @param selfBuilder - The column builder or expression builder that the operation is called on
 * @param args - The arguments passed to the operation
 * @param columnMeta - The metadata of the column the operation is called on
 * @returns An ExpressionBuilder wrapping the operation expression
 */
function executeOperation(
  signature: SqlOperationSignature,
  selfBuilder: AnyColumnBuilder | AnyExpressionBuilder,
  args: unknown[],
  columnMeta: StorageColumn,
  operationRegistry?: OperationRegistry,
  contractCapabilities?: Record<string, Record<string, boolean>>,
): AnyExpressionBuilder {
  if (args.length !== signature.args.length) {
    throw planInvalid(
      `Operation ${signature.method} expects ${signature.args.length} arguments, got ${args.length}`,
    );
  }

  // Extract the expression from selfBuilder (handles both ColumnBuilder and ExpressionBuilder)
  const selfExpr: ColumnRef | OperationExpr = extractExpression(selfBuilder);

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
      // Argument can be either ColumnBuilder or ExpressionBuilder
      if (!isColumnBuilder(arg) && !isExpressionBuilder(arg)) {
        throw planInvalid(`Argument ${i} must be a ColumnBuilder or ExpressionBuilder`);
      }
      // Extract expression from either type
      operationArgs.push(extractExpression(arg));
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
        codecId: returnTypeId,
      }
    : columnMeta;

  let result = createExpressionBuilder(operationExpr, returnColumnMeta);

  // If the return type is a typeId, attach operations for that type to the ExpressionBuilder.
  // This allows chaining operations (e.g., col.normalize().cosineDistance(otherVec)).
  if (returnTypeId && operationRegistry) {
    const operations = operationRegistry.byType(returnTypeId) as SqlOperationSignature[];
    if (operations.length > 0) {
      // Attach operations as methods on the ExpressionBuilder
      const resultWithOps = result as unknown as AnyExpressionBuilder & Record<string, unknown>;
      for (const operation of operations) {
        if (operation.capabilities && operation.capabilities.length > 0) {
          if (!contractCapabilities) {
            continue;
          }
          if (!hasAllCapabilities(operation.capabilities, contractCapabilities)) {
            continue;
          }
        }
        // Attach operation as a method on the expression builder
        (resultWithOps as Record<string, unknown>)[operation.method] = function (
          this: AnyExpressionBuilder,
          ...args: unknown[]
        ) {
          return executeOperation(
            operation,
            this,
            args,
            returnColumnMeta,
            operationRegistry,
            contractCapabilities,
          );
        };
      }
      result = Object.freeze(resultWithOps) as AnyExpressionBuilder;
    }
  }

  return result;
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

  // Use codecId to look up operations registered for this column's type
  const codecId = columnMeta.codecId;
  if (!codecId) {
    return columnBuilder as ColumnBuilder<ColumnName, ColumnMeta, JsType, Operations>;
  }

  const operations = registry.byType(codecId) as SqlOperationSignature[];
  if (operations.length === 0) {
    return columnBuilder as ColumnBuilder<ColumnName, ColumnMeta, JsType, Operations>;
  }

  const builderWithOps = columnBuilder as unknown as ColumnBuilder<
    ColumnName,
    ColumnMeta,
    JsType,
    Operations
  >;

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
