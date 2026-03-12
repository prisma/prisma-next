import type { OperationRegistry } from '@prisma-next/operations';
import { hasAllCapabilities } from '@prisma-next/operations';
import { planInvalid } from '@prisma-next/plan';
import type { StorageColumn } from '@prisma-next/sql-contract/types';
import type { SqlOperationSignature } from '@prisma-next/sql-operations';
import {
  type BinaryOp,
  type Expression,
  type ExpressionSource,
  LiteralExpr,
  OperationExpr,
  ParamRef,
} from './ast/types';
import type {
  AnyBinaryBuilder,
  AnyOrderBuilder,
  ColumnBuilder,
  ExpressionBuilder,
  OperationTypes,
  ParamPlaceholder,
} from './types';
import { isParamPlaceholder } from './utils/guards';

/**
 * Type guard to check if a value is an ExpressionSource (has toExpr method).
 */
function isExpressionSource(value: unknown): value is ExpressionSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toExpr' in value &&
    typeof (value as ExpressionSource).toExpr === 'function'
  );
}

/**
 * Executes an operation and returns an ExpressionBuilder.
 * This is the canonical entrypoint for operation invocation, enabling
 * future enhancements like telemetry, caching, or tracing.
 *
 * The returned ExpressionBuilder:
 * - Has `kind: 'expression'` to distinguish it from ColumnBuilder
 * - Contains the operation expression in `expr`
 * - Provides `toExpr()` method to get the Expression
 * - Provides comparison and ordering methods for chaining
 *
 * @param signature - The operation signature from the registry
 * @param selfBuilder - The expression source that the operation is called on
 * @param args - The arguments passed to the operation
 * @param columnMeta - The metadata of the column the operation is called on
 * @returns An ExpressionBuilder containing the operation expression
 */
function executeOperation(
  signature: SqlOperationSignature,
  selfBuilder: ExpressionSource,
  args: unknown[],
  columnMeta: StorageColumn,
  operationRegistry?: OperationRegistry,
  contractCapabilities?: Record<string, Record<string, boolean>>,
): ExpressionBuilder {
  if (args.length !== signature.args.length) {
    throw planInvalid(
      `Operation ${signature.method} expects ${signature.args.length} arguments, got ${args.length}`,
    );
  }

  // Get the Expression from the self builder using toExpr()
  const selfExpr: Expression = selfBuilder.toExpr();

  const operationArgs: Array<Expression | ParamRef | LiteralExpr> = [];
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
      operationArgs.push(new ParamRef(0, arg.name));
    } else if (argSpec.kind === 'typeId') {
      // Accept ExpressionSource (ColumnBuilder or ExpressionBuilder)
      if (!isExpressionSource(arg)) {
        throw planInvalid(
          `Argument ${i} must be an ExpressionSource (ColumnBuilder or ExpressionBuilder)`,
        );
      }
      // Use toExpr() to get the Expression
      operationArgs.push(arg.toExpr());
    } else if (argSpec.kind === 'literal') {
      operationArgs.push(new LiteralExpr(arg));
    }
  }

  const operationExpr = new OperationExpr({
    method: signature.method,
    forTypeId: signature.forTypeId,
    self: selfExpr,
    args: operationArgs,
    returns: signature.returns,
    lowering: signature.lowering,
  });

  const returnTypeId = signature.returns.kind === 'typeId' ? signature.returns.type : undefined;
  const returnColumnMeta: StorageColumn = returnTypeId
    ? {
        ...columnMeta,
        codecId: returnTypeId,
      }
    : columnMeta;

  const createComparisonMethod =
    (op: BinaryOp) =>
    (value: ParamPlaceholder | ExpressionSource): AnyBinaryBuilder =>
      Object.freeze({
        kind: 'binary' as const,
        op,
        left: operationExpr,
        right: value,
      }) as AnyBinaryBuilder;

  const baseResult: ExpressionBuilder = {
    kind: 'expression' as const,
    expr: operationExpr,
    get columnMeta() {
      return returnColumnMeta;
    },
    eq: createComparisonMethod('eq'),
    neq: createComparisonMethod('neq'),
    gt: createComparisonMethod('gt'),
    lt: createComparisonMethod('lt'),
    gte: createComparisonMethod('gte'),
    lte: createComparisonMethod('lte'),
    asc(): AnyOrderBuilder {
      return Object.freeze({
        kind: 'order' as const,
        expr: operationExpr,
        dir: 'asc' as const,
      });
    },
    desc(): AnyOrderBuilder {
      return Object.freeze({
        kind: 'order' as const,
        expr: operationExpr,
        dir: 'desc' as const,
      });
    },
    toExpr(): OperationExpr {
      return operationExpr;
    },
    get __jsType(): unknown {
      return undefined;
    },
  };

  // If the return type is a typeId, attach operations for that type
  if (returnTypeId && operationRegistry) {
    const resultWithOps = attachOperationsToExpressionBuilder(
      baseResult,
      returnColumnMeta,
      operationRegistry,
      contractCapabilities,
    );
    return Object.freeze(resultWithOps);
  }

  return Object.freeze(baseResult);
}

/**
 * Attaches operation methods to an ExpressionBuilder for chained operations.
 * When an operation returns a typeId, the result ExpressionBuilder needs
 * operation methods for that type.
 */
function attachOperationsToExpressionBuilder(
  expressionBuilder: ExpressionBuilder,
  columnMeta: StorageColumn,
  registry: OperationRegistry,
  contractCapabilities?: Record<string, Record<string, boolean>>,
): ExpressionBuilder {
  const codecId = columnMeta.codecId;
  if (!codecId) {
    return expressionBuilder;
  }

  const operations = registry.byType(codecId) as SqlOperationSignature[];
  if (operations.length === 0) {
    return expressionBuilder;
  }

  const builderWithOps = expressionBuilder as ExpressionBuilder & Record<string, unknown>;

  for (const operation of operations) {
    if (operation.capabilities && operation.capabilities.length > 0) {
      if (!contractCapabilities) {
        continue;
      }

      if (!hasAllCapabilities(operation.capabilities, contractCapabilities)) {
        continue;
      }
    }
    // Method sugar: attach operation as a method on the expression builder
    builderWithOps[operation.method] = function (this: ExpressionBuilder, ...args: unknown[]) {
      return executeOperation(operation, this, args, columnMeta, registry, contractCapabilities);
    };
  }

  return builderWithOps;
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
    // Operations return ExpressionBuilder, not ColumnBuilder
    (builderWithOps as Record<string, unknown>)[operation.method] = function (
      this: ColumnBuilder<ColumnName, ColumnMeta, JsType, Record<string, never>>,
      ...args: unknown[]
    ) {
      return executeOperation(operation, this, args, columnMeta, registry, contractCapabilities);
    };
  }

  return builderWithOps;
}
