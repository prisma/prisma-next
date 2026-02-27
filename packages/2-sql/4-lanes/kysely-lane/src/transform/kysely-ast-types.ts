import {
  AliasNode,
  ColumnNode,
  DeleteQueryNode,
  FromNode,
  IdentifierNode,
  InsertQueryNode,
  OnNode,
  type OperationNode,
  type OrderByItemNode,
  RawNode,
  ReferenceNode,
  SchemableIdentifierNode,
  SelectAllNode,
  SelectionNode,
  SelectQueryNode,
  TableNode,
  UpdateQueryNode,
  WhereNode,
} from 'kysely';

export type TransformableRootNode =
  | SelectQueryNode
  | InsertQueryNode
  | UpdateQueryNode
  | DeleteQueryNode;

export interface TableReferenceInfo {
  readonly table: string;
  readonly alias?: string;
}

export function hasKind(node: unknown, kind: string): node is OperationNode {
  return isOperationNode(node) && node.kind === kind;
}

export function isOperationNode(node: unknown): node is OperationNode {
  return (
    typeof node === 'object' &&
    node !== null &&
    'kind' in node &&
    typeof (node as { kind?: unknown }).kind === 'string'
  );
}

export function isTransformableRootNode(node: unknown): node is TransformableRootNode {
  if (!isOperationNode(node)) {
    return false;
  }
  return (
    SelectQueryNode.is(node) ||
    InsertQueryNode.is(node) ||
    UpdateQueryNode.is(node) ||
    DeleteQueryNode.is(node)
  );
}

export function getIdentifierName(node: OperationNode | undefined): string | undefined {
  if (!node) {
    return undefined;
  }
  if (IdentifierNode.is(node)) {
    return node.name;
  }
  return undefined;
}

function getSchemableIdentifierName(node: unknown): string | undefined {
  if (!isOperationNode(node)) {
    return undefined;
  }

  if (SchemableIdentifierNode.is(node)) {
    return getIdentifierName(node.identifier);
  }

  // Some compiled query shapes inline IdentifierNode directly in table slots.
  if (IdentifierNode.is(node)) {
    return node.name;
  }

  return undefined;
}

export function getAliasName(node: unknown): string | undefined {
  if (!isOperationNode(node)) {
    return undefined;
  }
  if (!AliasNode.is(node)) {
    return undefined;
  }
  return getIdentifierName(node.alias);
}

export function getTableName(node: unknown): string | undefined {
  if (!isOperationNode(node)) {
    return undefined;
  }

  if (AliasNode.is(node)) {
    return getTableName(node.node);
  }

  if (FromNode.is(node)) {
    const firstFrom = node.froms[0];
    return firstFrom ? getTableName(firstFrom) : undefined;
  }

  if (ReferenceNode.is(node)) {
    if (node.table) {
      return getTableName(node.table);
    }
    // Backward-compatible fallback for legacy compiled-query shapes.
    const legacyColumnTable = (node as { column?: { table?: OperationNode } }).column?.table;
    return legacyColumnTable ? getTableName(legacyColumnTable) : undefined;
  }

  if (TableNode.is(node)) {
    return getSchemableIdentifierName(node.table);
  }

  if (SchemableIdentifierNode.is(node)) {
    return getSchemableIdentifierName(node);
  }

  if (IdentifierNode.is(node)) {
    return node.name;
  }

  return undefined;
}

export function getColumnName(node: unknown): string | undefined {
  if (!isOperationNode(node)) {
    return undefined;
  }

  if (AliasNode.is(node)) {
    return getColumnName(node.node);
  }

  if (ReferenceNode.is(node)) {
    return getColumnName(node.column);
  }

  if (ColumnNode.is(node)) {
    return getIdentifierName(node.column);
  }

  if (IdentifierNode.is(node)) {
    return node.name;
  }

  return undefined;
}

export function getTableReferenceInfo(node: unknown): TableReferenceInfo | undefined {
  if (!isOperationNode(node)) {
    return undefined;
  }

  if (FromNode.is(node)) {
    const firstFrom = node.froms[0];
    return firstFrom ? getTableReferenceInfo(firstFrom) : undefined;
  }

  if (AliasNode.is(node)) {
    const inner = getTableReferenceInfo(node.node);
    if (!inner) {
      return undefined;
    }
    const alias = getIdentifierName(node.alias);
    return alias ? { table: inner.table, alias } : inner;
  }

  if (TableNode.is(node)) {
    const table = getTableName(node);
    return table ? { table } : undefined;
  }

  return undefined;
}

export function unwrapWhereNode(node: unknown): OperationNode | undefined {
  if (!isOperationNode(node)) {
    return undefined;
  }
  if (!WhereNode.is(node)) {
    return node;
  }
  return node.where ?? (node as { node?: OperationNode }).node;
}

export function unwrapOnNode(node: unknown): OperationNode | undefined {
  if (!isOperationNode(node)) {
    return undefined;
  }
  if (!OnNode.is(node)) {
    return node;
  }
  return node.on ?? (node as { node?: OperationNode }).node;
}

export function unwrapSelectionNode(node: OperationNode): OperationNode {
  return SelectionNode.is(node) ? node.selection : node;
}

export function unwrapAliasNode(node: OperationNode): {
  readonly node: OperationNode;
  readonly alias?: string;
} {
  if (!AliasNode.is(node)) {
    return { node };
  }
  const alias = getIdentifierName(node.alias);
  return alias ? { node: node.node, alias } : { node: node.node };
}

export function isSelectAllReference(
  node: OperationNode,
): node is ReferenceNode & { readonly column: SelectAllNode } {
  return ReferenceNode.is(node) && SelectAllNode.is(node.column);
}

export function parseOrderByDirection(node: OrderByItemNode): 'asc' | 'desc' {
  if (!node.direction) {
    return 'asc';
  }

  if (RawNode.is(node.direction)) {
    const direction = node.direction.sqlFragments.join('').trim().toLowerCase();
    return direction === 'desc' ? 'desc' : 'asc';
  }

  if (IdentifierNode.is(node.direction)) {
    return node.direction.name.toLowerCase() === 'desc' ? 'desc' : 'asc';
  }

  return 'asc';
}
