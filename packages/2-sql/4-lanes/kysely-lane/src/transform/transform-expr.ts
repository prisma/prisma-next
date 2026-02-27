import type { ParamDescriptor } from '@prisma-next/contract/types';
import type {
  BinaryOp,
  ColumnRef,
  Direction,
  Expression,
  JoinOnExpr,
  ListLiteralExpr,
  LiteralExpr,
  ParamRef,
  WhereExpr,
} from '@prisma-next/sql-relational-core/ast';
import {
  AndNode,
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
import { hasKind, isOperationNode, parseOrderByDirection } from './kysely-ast-types';
import { addParamDescriptor, nextParamIndex, type TransformContext } from './transform-context';
import { resolveColumnRef } from './transform-validate';

export function transformValue(
  node: unknown,
  ctx: TransformContext,
  refs?: { table: string; column: string },
): ParamRef | LiteralExpr {
  const addDescriptorForCurrentParam = (): void => {
    const colDef = refs ? ctx.contract.storage.tables[refs.table]?.columns[refs.column] : undefined;
    const descriptor: Omit<ParamDescriptor, 'index' | 'source'> = {
      ...(refs && { refs }),
      ...(colDef?.codecId !== undefined && colDef.codecId !== '' && { codecId: colDef.codecId }),
      ...(colDef?.nativeType !== undefined &&
        colDef.nativeType !== '' && { nativeType: colDef.nativeType }),
      ...(refs && colDef !== undefined && { nullable: colDef.nullable ?? false }),
    };
    addParamDescriptor(ctx, descriptor);
  };

  if (!isOperationNode(node)) {
    const nextCompiledParam = ctx.parameters[ctx.paramIndex];
    if (ctx.paramIndex < ctx.parameters.length && Object.is(nextCompiledParam, node)) {
      const index = nextParamIndex(ctx);
      addDescriptorForCurrentParam();
      return { kind: 'param', index };
    }
    return { kind: 'literal', value: node };
  }

  if (ValueNode.is(node)) {
    if (node.immediate === true) {
      return { kind: 'literal', value: node.value };
    }
    const index = nextParamIndex(ctx);
    addDescriptorForCurrentParam();
    return { kind: 'param', index };
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
  out: WhereExpr[],
): void {
  const current = ParensNode.is(node) ? node.node : node;
  const getLegacyLogicalSides = (
    candidate: OperationNode,
  ): { left?: OperationNode; right?: OperationNode; exprs?: OperationNode[] } =>
    candidate as {
      left?: OperationNode;
      right?: OperationNode;
      exprs?: OperationNode[];
    };

  if (logicalKind === 'and' && hasKind(current, 'AndNode')) {
    const legacyLogicalNode = getLegacyLogicalSides(current);
    const exprs = legacyLogicalNode.exprs;
    if (exprs && exprs.length > 0) {
      for (const expr of exprs) {
        flattenLogical(expr, logicalKind, ctx, defaultTable, out);
      }
      return;
    }
    if (!legacyLogicalNode.left || !legacyLogicalNode.right) {
      return;
    }
    flattenLogical(legacyLogicalNode.left, logicalKind, ctx, defaultTable, out);
    flattenLogical(legacyLogicalNode.right, logicalKind, ctx, defaultTable, out);
    return;
  }

  if (logicalKind === 'or' && hasKind(current, 'OrNode')) {
    const legacyLogicalNode = getLegacyLogicalSides(current);
    const exprs = legacyLogicalNode.exprs;
    if (exprs && exprs.length > 0) {
      for (const expr of exprs) {
        flattenLogical(expr, logicalKind, ctx, defaultTable, out);
      }
      return;
    }
    if (!legacyLogicalNode.left || !legacyLogicalNode.right) {
      return;
    }
    flattenLogical(legacyLogicalNode.left, logicalKind, ctx, defaultTable, out);
    flattenLogical(legacyLogicalNode.right, logicalKind, ctx, defaultTable, out);
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
    return {
      kind: 'listLiteral',
      values: node.values.map((value) => transformValue(value, ctx, refs)),
    };
  }

  if (ValueListNode.is(node)) {
    return {
      kind: 'listLiteral',
      values: node.values.map((value) => transformValue(value, ctx, refs)),
    };
  }

  return transformValue(node, ctx, refs);
}

export function transformWhereExpr(
  node: unknown,
  ctx: TransformContext,
  defaultTable?: string,
): WhereExpr | undefined {
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
    const exprs: WhereExpr[] = [];
    flattenLogical(node, 'and', ctx, defaultTable, exprs);
    if (exprs.length === 0) return undefined;
    if (exprs.length === 1) return exprs[0];
    return { kind: 'and', exprs };
  }

  if (OrNode.is(node)) {
    const exprs: WhereExpr[] = [];
    flattenLogical(node, 'or', ctx, defaultTable, exprs);
    if (exprs.length === 0) return undefined;
    if (exprs.length === 1) return exprs[0];
    return { kind: 'or', exprs };
  }

  if (!hasKind(node, 'BinaryOperationNode')) {
    return undefined;
  }

  const binaryNode = node as OperationNode & {
    operator?: unknown;
    leftOperand?: OperationNode;
    rightOperand?: OperationNode;
    left?: OperationNode;
    right?: OperationNode;
  };
  const operatorString = getOperatorFromNode(binaryNode.operator);
  const operator = operatorString ? mapOperator(operatorString) : undefined;
  if (!operator) {
    throw new KyselyTransformError(
      `Unsupported operator: ${operatorString ?? 'unknown'}`,
      KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
      { nodeKind: node.kind, operator: operatorString },
    );
  }

  const leftNode = binaryNode.leftOperand ?? binaryNode.left;
  const rightNode = binaryNode.rightOperand ?? binaryNode.right;

  if (!leftNode || !rightNode) {
    return undefined;
  }

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

  return {
    kind: 'bin',
    op: operator,
    left,
    right,
  };
}

export function transformOrderByItem(
  node: unknown,
  ctx: TransformContext,
  defaultTable?: string,
): { expr: Expression; dir: Direction } | undefined {
  if (!isOperationNode(node) || !OrderByItemNode.is(node)) {
    return undefined;
  }

  const colRef = resolveColumnRef(node.orderBy, ctx, defaultTable);
  const dir = parseOrderByDirection(node);
  return { expr: colRef, dir };
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
    expr.kind === 'bin' &&
    expr.op === 'eq' &&
    expr.left.kind === 'col' &&
    expr.right.kind === 'col'
  ) {
    return {
      kind: 'eqCol',
      left: expr.left,
      right: expr.right,
    };
  }

  return expr;
}
