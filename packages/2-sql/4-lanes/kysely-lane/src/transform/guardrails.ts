import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  AliasNode,
  AndNode,
  BinaryOperationNode,
  JoinNode,
  OnNode,
  type OperationNode,
  OrderByItemNode,
  OrderByNode,
  OrNode,
  ParensNode,
  ReferenceNode,
  SelectAllNode,
  SelectionNode,
  SelectQueryNode,
  WhereNode,
} from 'kysely';
import { KYSELY_TRANSFORM_ERROR_CODES, KyselyTransformError } from './errors';
import {
  getTableName,
  isSelectAllReference,
  unwrapAliasNode,
  unwrapOnNode,
  unwrapSelectionNode,
  unwrapWhereNode,
} from './kysely-ast-types';

function isMultiTableSelect(node: SelectQueryNode): boolean {
  const hasJoins = (node.joins?.length ?? 0) > 0;
  const hasMultiFrom = (node.from?.froms.length ?? 0) > 1;
  return hasJoins || hasMultiFrom;
}

function checkUnqualifiedColumnRef(node: OperationNode, multiTable: boolean, path: string): void {
  if (!multiTable) {
    return;
  }

  if (!ReferenceNode.is(node)) {
    return;
  }

  if (SelectAllNode.is(node.column)) {
    return;
  }

  if (!getTableName(node)) {
    throw new KyselyTransformError(
      'Unqualified column reference in multi-table scope; use table.column (e.g. user.id)',
      KYSELY_TRANSFORM_ERROR_CODES.UNQUALIFIED_REF_IN_MULTI_TABLE,
      { path },
    );
  }
}

function walkForColumnRefs(node: unknown, multiTable: boolean, path: string): void {
  if (!node) return;

  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index++) {
      walkForColumnRefs(node[index], multiTable, `${path}[${index}]`);
    }
    return;
  }

  if (typeof node !== 'object' || node === null || !('kind' in node)) {
    return;
  }

  const operation = node as OperationNode;
  checkUnqualifiedColumnRef(operation, multiTable, path);

  if (SelectionNode.is(operation)) {
    walkForColumnRefs(operation.selection, multiTable, `${path}.selection`);
    return;
  }

  if (AliasNode.is(operation)) {
    walkForColumnRefs(operation.node, multiTable, `${path}.node`);
    return;
  }

  if (WhereNode.is(operation)) {
    walkForColumnRefs(unwrapWhereNode(operation), multiTable, `${path}.where`);
    return;
  }

  if (OnNode.is(operation)) {
    walkForColumnRefs(unwrapOnNode(operation), multiTable, `${path}.on`);
    return;
  }

  if (ParensNode.is(operation)) {
    walkForColumnRefs(operation.node, multiTable, `${path}.node`);
    return;
  }

  if (BinaryOperationNode.is(operation)) {
    const leftOperand = operation.leftOperand ?? (operation as { left?: OperationNode }).left;
    const rightOperand = operation.rightOperand ?? (operation as { right?: OperationNode }).right;
    walkForColumnRefs(leftOperand, multiTable, `${path}.leftOperand`);
    walkForColumnRefs(rightOperand, multiTable, `${path}.rightOperand`);
    return;
  }

  if (AndNode.is(operation) || OrNode.is(operation)) {
    const exprs = (operation as { exprs?: unknown[] }).exprs;
    if (exprs && exprs.length > 0) {
      for (let index = 0; index < exprs.length; index++) {
        walkForColumnRefs(exprs[index], multiTable, `${path}.exprs[${index}]`);
      }
      return;
    }
    walkForColumnRefs(operation.left, multiTable, `${path}.left`);
    walkForColumnRefs(operation.right, multiTable, `${path}.right`);
    return;
  }

  if (OrderByNode.is(operation)) {
    for (let index = 0; index < operation.items.length; index++) {
      walkForColumnRefs(operation.items[index], multiTable, `${path}.items[${index}]`);
    }
    return;
  }

  if (OrderByItemNode.is(operation)) {
    walkForColumnRefs(operation.orderBy, multiTable, `${path}.orderBy`);
    return;
  }

  if (JoinNode.is(operation)) {
    if (operation.on) {
      walkForColumnRefs(operation.on, multiTable, `${path}.on`);
    }
  }
}

function checkSelectAllAmbiguity(
  selections: ReadonlyArray<SelectionNode> | undefined,
  multiTable: boolean,
): void {
  if (!multiTable || !selections) {
    return;
  }

  for (const selection of selections) {
    const unwrappedSelection = unwrapSelectionNode(selection);
    const { node: selectionNode } = unwrapAliasNode(unwrappedSelection);

    if (SelectAllNode.is(selectionNode)) {
      const explicitSelectAllRef =
        (selectionNode as { table?: unknown; reference?: unknown }).table ??
        (selectionNode as { table?: unknown; reference?: unknown }).reference;
      if (explicitSelectAllRef) {
        continue;
      }
      throw new KyselyTransformError(
        "Ambiguous selectAll in multi-table scope; qualify with table (e.g. db.selectFrom(u).innerJoin(p).selectAll('user'))",
        KYSELY_TRANSFORM_ERROR_CODES.AMBIGUOUS_SELECT_ALL,
      );
    }

    if (isSelectAllReference(selectionNode) && !getTableName(selectionNode)) {
      throw new KyselyTransformError(
        "Ambiguous selectAll in multi-table scope; qualify with table (e.g. db.selectFrom(u).innerJoin(p).selectAll('user'))",
        KYSELY_TRANSFORM_ERROR_CODES.AMBIGUOUS_SELECT_ALL,
      );
    }
  }
}

export function runGuardrails(_contract: SqlContract<SqlStorage>, query: unknown): void {
  if (!query || typeof query !== 'object' || !('kind' in query)) {
    return;
  }

  const operationNode = query as OperationNode;
  if (!SelectQueryNode.is(operationNode)) {
    return;
  }
  const selectQuery = operationNode;

  const multiTable = isMultiTableSelect(selectQuery);

  walkForColumnRefs(selectQuery.selections, multiTable, 'selections');
  walkForColumnRefs(unwrapWhereNode(selectQuery.where), multiTable, 'where.where');
  walkForColumnRefs(selectQuery.orderBy?.items, multiTable, 'orderBy.items');

  for (let index = 0; index < (selectQuery.joins?.length ?? 0); index++) {
    const join = selectQuery.joins?.[index];
    walkForColumnRefs(unwrapOnNode(join?.on), multiTable, `joins[${index}].on.on`);
  }

  checkSelectAllAmbiguity(selectQuery.selections, multiTable);
}
