import type { AnyWhereExpr, BinaryOp, JoinOnExpr } from '@prisma-next/sql-relational-core/ast';
import {
  AndExpr,
  BinaryExpr,
  type ColumnRef,
  EqColJoinOn,
  ListLiteralExpr,
  LiteralExpr,
  OrderByItem,
  OrExpr,
  ParamRef,
} from '@prisma-next/sql-relational-core/ast';
import {
  AndNode,
  BinaryOperationNode,
  type OperationNode,
  OperatorNode,
  OrderByItemNode,
  OrNode,
  ParensNode,
  PrimitiveValueListNode,
  ReferenceNode,
  ValueListNode,
  ValueNode,
} from 'kysely';
import { KYSELY_TRANSFORM_ERROR_CODES, KyselyTransformError } from './errors';
import { isOperationNode, parseOrderByDirection } from './kysely-ast-types';
import { advanceParamCursor, type TransformContext } from './transform-context';
import { resolveColumnRef } from './transform-validate';

function resolveParamOptions(ctx: TransformContext, refs?: { table: string; column: string }) {
  const colDef = refs ? ctx.contract.storage.tables[refs.table]?.columns[refs.column] : undefined;
  const codecId =
    colDef?.codecId !== undefined && colDef.codecId !== '' ? colDef.codecId : undefined;
  const nativeType =
    colDef?.nativeType !== undefined && colDef.nativeType !== '' ? colDef.nativeType : undefined;
  return {
    ...(codecId !== undefined && { codecId }),
    ...(nativeType !== undefined && { nativeType }),
  };
}

export function transformValue(
  node: unknown,
  ctx: TransformContext,
  refs?: { table: string; column: string },
): ParamRef | LiteralExpr {
  const options = resolveParamOptions(ctx, refs);

  if (!isOperationNode(node)) {
    if (ctx.parameters) {
      const nextCompiledParam = ctx.parameters[ctx.paramIndex];
      if (ctx.paramIndex < ctx.parameters.length && Object.is(nextCompiledParam, node)) {
        advanceParamCursor(ctx);
        return ParamRef.of(node, options);
      }
      return LiteralExpr.of(node);
    }

    advanceParamCursor(ctx);
    return ParamRef.of(node, options);
  }

  if (ValueNode.is(node)) {
    if (node.immediate === true) {
      return LiteralExpr.of(node.value);
    }
    advanceParamCursor(ctx);
    return ParamRef.of(node.value, options);
  }

  throw new KyselyTransformError(
    `Unsupported value node: ${node.kind}`,
    KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
    { nodeKind: node.kind },
  );
}

export function mapOperator(op: string): BinaryOp | undefined {
  const normalized = op.trim().toLowerCase();
  const map: Record<string, BinaryOp> = {
    '=': 'eq',
    '==': 'eq',
    '<>': 'neq',
    '!=': 'neq',
    '>': 'gt',
    '<': 'lt',
    '>=': 'gte',
    '<=': 'lte',
    like: 'like',
    ilike: 'ilike',
    in: 'in',
    'not in': 'notIn',
    notin: 'notIn',
  };
  return map[normalized];
}

export function getOperatorFromNode(node: unknown): string | undefined {
  if (!isOperationNode(node) || !OperatorNode.is(node)) {
    return undefined;
  }
  return typeof node.operator === 'string' ? node.operator : undefined;
}

function flattenLogical(
  node: OperationNode,
  logicalKind: 'and' | 'or',
  ctx: TransformContext,
  defaultTable: string | undefined,
  out: AnyWhereExpr[],
): void {
  const current = ParensNode.is(node) ? node.node : node;
  if (logicalKind === 'and' && AndNode.is(current)) {
    flattenLogical(current.left, logicalKind, ctx, defaultTable, out);
    flattenLogical(current.right, logicalKind, ctx, defaultTable, out);
    return;
  }

  if (logicalKind === 'or' && OrNode.is(current)) {
    flattenLogical(current.left, logicalKind, ctx, defaultTable, out);
    flattenLogical(current.right, logicalKind, ctx, defaultTable, out);
    return;
  }

  const transformed = transformWhereExpr(current, ctx, defaultTable);
  if (transformed) {
    out.push(transformed);
  }
}

function transformRightOperand(
  node: OperationNode,
  ctx: TransformContext,
  defaultTable: string | undefined,
  refs: { table: string; column: string },
): ColumnRef | ParamRef | LiteralExpr | ListLiteralExpr {
  if (ReferenceNode.is(node)) {
    return resolveColumnRef(node, ctx, defaultTable);
  }

  if (PrimitiveValueListNode.is(node)) {
    return ListLiteralExpr.of(node.values.map((value) => transformValue(value, ctx, refs)));
  }

  if (ValueListNode.is(node)) {
    return ListLiteralExpr.of(node.values.map((value) => transformValue(value, ctx, refs)));
  }

  return transformValue(node, ctx, refs);
}

export function transformWhereExpr(
  node: unknown,
  ctx: TransformContext,
  defaultTable?: string,
): AnyWhereExpr | undefined {
  if (!node) {
    return undefined;
  }

  if (!isOperationNode(node)) {
    return undefined;
  }

  if (ParensNode.is(node)) {
    return transformWhereExpr(node.node, ctx, defaultTable);
  }

  if (AndNode.is(node)) {
    const exprs: AnyWhereExpr[] = [];
    flattenLogical(node, 'and', ctx, defaultTable, exprs);
    if (exprs.length === 0) return undefined;
    if (exprs.length === 1) return exprs[0];
    return AndExpr.of(exprs);
  }

  if (OrNode.is(node)) {
    const exprs: AnyWhereExpr[] = [];
    flattenLogical(node, 'or', ctx, defaultTable, exprs);
    if (exprs.length === 0) return undefined;
    if (exprs.length === 1) return exprs[0];
    return OrExpr.of(exprs);
  }

  if (!BinaryOperationNode.is(node)) {
    return undefined;
  }

  const binaryNode = node;
  const operatorString = getOperatorFromNode(binaryNode.operator);
  const operator = operatorString ? mapOperator(operatorString) : undefined;
  if (!operator) {
    throw new KyselyTransformError(
      `Unsupported operator: ${operatorString ?? 'unknown'}`,
      KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
      { nodeKind: node.kind, operator: operatorString },
    );
  }

  const leftNode = binaryNode.leftOperand;
  const rightNode = binaryNode.rightOperand;

  if (!ReferenceNode.is(leftNode)) {
    throw new KyselyTransformError(
      `Unsupported left operand kind: ${leftNode.kind}`,
      KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
      { nodeKind: leftNode.kind },
    );
  }

  const left = resolveColumnRef(leftNode, ctx, defaultTable);
  const right = transformRightOperand(rightNode, ctx, defaultTable, {
    table: left.table,
    column: left.column,
  });

  return new BinaryExpr(operator, left, right);
}

export function transformOrderByItem(
  node: unknown,
  ctx: TransformContext,
  defaultTable?: string,
): OrderByItem | undefined {
  if (!isOperationNode(node) || !OrderByItemNode.is(node)) {
    return undefined;
  }

  const colRef = resolveColumnRef(node.orderBy, ctx, defaultTable);
  const dir = parseOrderByDirection(node);
  return new OrderByItem(colRef, dir);
}

export function transformJoinOn(
  node: unknown,
  ctx: TransformContext,
  _leftTable: string,
  _rightTable: string,
): JoinOnExpr {
  const expr = transformWhereExpr(node, ctx);
  if (!expr) {
    throw new KyselyTransformError(
      'Join ON clause is required',
      KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF,
    );
  }

  if (
    expr.kind === 'binary' &&
    expr.op === 'eq' &&
    expr.left.kind === 'column-ref' &&
    expr.right.kind === 'column-ref'
  ) {
    return EqColJoinOn.of(expr.left, expr.right);
  }

  return expr;
}
