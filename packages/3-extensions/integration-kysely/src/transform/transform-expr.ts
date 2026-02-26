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
import { KYSELY_TRANSFORM_ERROR_CODES, KyselyTransformError } from './errors';
import { hasKind } from './kysely-ast-types';
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

  if (typeof node !== 'object' || node === null) {
    const nextCompiledParam = ctx.parameters[ctx.paramIndex];
    if (ctx.paramIndex < ctx.parameters.length && Object.is(nextCompiledParam, node)) {
      const idx = nextParamIndex(ctx);
      addDescriptorForCurrentParam();
      return { kind: 'param', index: idx };
    }
    return { kind: 'literal', value: node };
  }
  const n = node as Record<string, unknown>;
  if (hasKind(node, 'ValueNode')) {
    const idx = nextParamIndex(ctx);
    addDescriptorForCurrentParam();
    return { kind: 'param', index: idx };
  }
  const nodeKind = String((n as { kind?: string })['kind'] ?? 'unknown');
  throw new KyselyTransformError(
    `Unsupported value node: ${nodeKind}`,
    KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
    { nodeKind },
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
    notIn: 'notIn',
  };
  return map[normalized];
}

export function getOperatorFromNode(node: unknown): string | undefined {
  if (typeof node !== 'object' || node === null) return undefined;
  const n = node as Record<string, unknown>;
  if (hasKind(node, 'OperatorNode')) {
    const op = n['operator'];
    if (typeof op === 'string') {
      return op;
    }
    return undefined;
  }
  return undefined;
}

export function transformWhereExpr(
  node: unknown,
  ctx: TransformContext,
  defaultTable?: string,
): WhereExpr | undefined {
  if (!node) return undefined;
  if (typeof node !== 'object') return undefined;

  const n = node as Record<string, unknown>;

  if (hasKind(node, 'ParensNode')) {
    return transformWhereExpr(n['node'], ctx, defaultTable);
  }

  const exprsArr = n['exprs'];
  if (hasKind(node, 'AndNode') || n['kind'] === 'AndNode') {
    const arr = Array.isArray(exprsArr)
      ? exprsArr
      : [n['left'], n['right']].filter((value): value is unknown => value !== undefined);
    const exprs = arr
      .map((e: unknown) => transformWhereExpr(e, ctx, defaultTable))
      .filter((e): e is WhereExpr => e !== undefined);
    if (exprs.length === 0) return undefined;
    if (exprs.length === 1) return exprs[0];
    return { kind: 'and', exprs };
  }

  const orExprsArr = n['exprs'];
  if (hasKind(node, 'OrNode') || n['kind'] === 'OrNode') {
    const orArr = Array.isArray(orExprsArr)
      ? orExprsArr
      : [n['left'], n['right']].filter((value): value is unknown => value !== undefined);
    const exprs = orArr
      .map((e: unknown) => transformWhereExpr(e, ctx, defaultTable))
      .filter((e): e is WhereExpr => e !== undefined);
    if (exprs.length === 0) return undefined;
    if (exprs.length === 1) return exprs[0];
    return { kind: 'or', exprs };
  }

  if (
    hasKind(node, 'BinaryOperationNode') ||
    ((n['kind'] === 'BinaryOperationNode' || hasKind(node, 'BinaryOperationNode')) &&
      n['operator'] &&
      (n['left'] || n['leftOperand']) &&
      (n['right'] || n['rightOperand']))
  ) {
    const leftNode = (n['left'] ?? n['leftOperand']) as unknown;
    const rightNode = (n['right'] ?? n['rightOperand']) as unknown;
    const opNode = n['operator'] as unknown;
    const opStr = getOperatorFromNode(opNode);
    const op = opStr ? mapOperator(opStr) : undefined;
    if (!op) {
      throw new KyselyTransformError(
        `Unsupported operator: ${opStr ?? 'unknown'}`,
        KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
        { nodeKind: 'BinaryOperationNode', operator: opStr },
      );
    }

    let left: ColumnRef | ParamRef | LiteralExpr;
    let right: ColumnRef | ParamRef | LiteralExpr | ListLiteralExpr;

    if (hasKind(leftNode, 'ReferenceNode')) {
      const leftRec = leftNode as Record<string, unknown>;
      const colRef = resolveColumnRef(leftRec['column'] ?? leftNode, ctx, defaultTable);
      left = colRef;
      ctx.refsColumns.set(`${colRef.table}.${colRef.column}`, {
        table: colRef.table,
        column: colRef.column,
      });

      if (hasKind(rightNode, 'ReferenceNode')) {
        const rightRec = rightNode as Record<string, unknown>;
        right = resolveColumnRef(rightRec['column'] ?? rightNode, ctx, defaultTable);
      } else if (hasKind(rightNode, 'ValueNode')) {
        right = transformValue(rightNode, ctx, { table: colRef.table, column: colRef.column });
      } else if (
        hasKind(rightNode, 'PrimitiveValueListNode') ||
        ((rightNode as Record<string, unknown>)['kind'] === 'PrimitiveValueListNode' &&
          Array.isArray((rightNode as Record<string, unknown>)['values']))
      ) {
        const rightRec = rightNode as Record<string, unknown>;
        const values = (rightRec['values'] ?? []) as unknown[];
        const listValues = values.map((v: unknown) =>
          transformValue(v, ctx, { table: colRef.table, column: colRef.column }),
        );
        right = { kind: 'listLiteral', values: listValues };
      } else {
        right = transformValue(rightNode, ctx);
      }
    } else {
      const nodeKind =
        typeof leftNode === 'object' && leftNode !== null && 'kind' in leftNode
          ? String((leftNode as { kind?: unknown }).kind ?? 'unknown')
          : 'unknown';
      throw new KyselyTransformError(
        `Unsupported left operand kind: ${nodeKind}`,
        KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
        { nodeKind },
      );
    }

    return {
      kind: 'bin',
      op,
      left,
      right,
    };
  }

  return undefined;
}

export function transformOrderByItem(
  node: unknown,
  ctx: TransformContext,
  defaultTable?: string,
): { expr: Expression; dir: Direction } | undefined {
  if (typeof node !== 'object' || node === null) return undefined;
  const n = node as Record<string, unknown>;
  const exprNode = n['column'] ?? n['orderBy'] ?? n;
  const colRef = resolveColumnRef(exprNode, ctx, defaultTable);
  const directionNode = n['direction'];
  const directionValue = (() => {
    if (typeof directionNode === 'string') {
      return directionNode;
    }
    if (typeof directionNode !== 'object' || directionNode === null) {
      return '';
    }
    const directionRecord = directionNode as Record<string, unknown>;
    const nested = directionRecord['direction'];
    if (typeof nested === 'string') {
      return nested;
    }
    const sqlFragments = directionRecord['sqlFragments'];
    if (Array.isArray(sqlFragments)) {
      return sqlFragments
        .map((fragment) => (typeof fragment === 'string' ? fragment : ''))
        .join(' ')
        .trim();
    }
    return '';
  })();
  const dir = (directionValue.toLowerCase() === 'desc' ? 'desc' : 'asc') as Direction;
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
      right: expr.right as ColumnRef,
    };
  }
  return expr;
}
