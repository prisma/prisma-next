import type { SchemaIssue } from './control-result-types';

export type SchemaDiffOutcome = 'missing' | 'extra' | 'mismatch';

export interface SchemaDiffIssue<TNode extends DiffableNode = DiffableNode> {
  /** Path from the root node down to the diffed node, as a sequence of local keys. */
  readonly path: readonly string[];
  readonly outcome: SchemaDiffOutcome;
  readonly message: string;
  /** The expected (contract-side) node, when available. Absent for `extra` outcomes. */
  readonly expected?: TNode;
  /** The actual (live-DB-side) node, when available. Absent for `missing` outcomes. */
  readonly actual?: TNode;
}

/**
 * A node in the schema tree. Every node in the tree implements this interface.
 *
 * `id` must be unique among sibling nodes at the same level — the differ keys
 * on it and treats a collision as the same entity (enforced by a duplicate-id
 * throw). The differ accumulates these ids into a path that stamps every emitted
 * issue.
 */
export interface DiffableNode {
  readonly id: string;
  isEqualTo(other: DiffableNode): boolean;
  children(): readonly DiffableNode[];
}

function insertNode(map: Map<string, DiffableNode>, node: DiffableNode): void {
  const key = node.id;
  if (map.has(key)) {
    throw new Error(`diffSchemas: duplicate id among siblings: ${key}`);
  }
  map.set(key, node);
}

function outcomeMessage(outcome: SchemaDiffOutcome, path: readonly string[]): string {
  return `${outcome}: ${path.join('/')}`;
}

function emitMissingSubtree(node: DiffableNode, parentPath: readonly string[]): SchemaDiffIssue[] {
  const path = [...parentPath, node.id];
  return [
    { path, outcome: 'missing', message: outcomeMessage('missing', path), expected: node },
    ...node.children().flatMap((c) => emitMissingSubtree(c, path)),
  ];
}

function emitExtraSubtree(node: DiffableNode, parentPath: readonly string[]): SchemaDiffIssue[] {
  const path = [...parentPath, node.id];
  return [
    { path, outcome: 'extra', message: outcomeMessage('extra', path), actual: node },
    ...node.children().flatMap((c) => emitExtraSubtree(c, path)),
  ];
}

/**
 * Diff two schema trees starting from their roots.
 *
 * The differ is **total**: every node-level difference is reported. An unmatched
 * non-leaf node emits its own issue and descends, emitting an issue for every
 * node in the missing/extra subtree. Coalescing a parent change over its
 * children is the planner's responsibility. Ownership filtering (dropping `extra`
 * issues in namespaces a contract doesn't own) is the caller's responsibility.
 */
export function diffSchemas(
  expected: DiffableNode,
  actual: DiffableNode,
): readonly SchemaDiffIssue[] {
  return diffPair(expected, actual, []);
}

function diffPair(
  expected: DiffableNode,
  actual: DiffableNode,
  parentPath: readonly string[],
): readonly SchemaDiffIssue[] {
  const path = [...parentPath, expected.id];
  const issues: SchemaDiffIssue[] = [];
  if (!expected.isEqualTo(actual)) {
    issues.push({
      path,
      outcome: 'mismatch',
      message: outcomeMessage('mismatch', path),
      expected,
      actual,
    });
  }
  issues.push(...diffChildren(expected.children(), actual.children(), path));
  return issues;
}

/**
 * Align one level of nodes by id; emit issues in input order and recurse.
 *
 * A missing node emits one issue for itself and one for every node in its
 * subtree (total descent). Same for extra nodes. A matched pair recurses via
 * `diffPair`.
 */
function diffChildren(
  expected: readonly DiffableNode[],
  actual: readonly DiffableNode[],
  parentPath: readonly string[],
): readonly SchemaDiffIssue[] {
  const expectedMap = new Map<string, DiffableNode>();
  for (const node of expected) {
    insertNode(expectedMap, node);
  }

  const actualMap = new Map<string, DiffableNode>();
  for (const node of actual) {
    insertNode(actualMap, node);
  }

  const issues: SchemaDiffIssue[] = [];

  for (const [key, expectedNode] of expectedMap) {
    const actualNode = actualMap.get(key);
    if (actualNode === undefined) {
      issues.push(...emitMissingSubtree(expectedNode, parentPath));
    } else {
      issues.push(...diffPair(expectedNode, actualNode, parentPath));
    }
  }

  for (const [key, actualNode] of actualMap) {
    if (!expectedMap.has(key)) {
      issues.push(...emitExtraSubtree(actualNode, parentPath));
    }
  }

  return issues;
}

/**
 * The two issue representations a `SchemaDiff` carries: `SchemaIssue` from the
 * legacy relational differ (coordinate-based) and `SchemaDiffIssue` from the
 * generic node differ (carrying the schema-IR node it concerns).
 */
export type DiffIssue<TNode extends DiffableNode = DiffableNode> =
  | SchemaIssue
  | SchemaDiffIssue<TNode>;

/**
 * The result of diffing a contract's expected schema against the introspected
 * actual schema: two issue lists, kept distinct because two diffing mechanisms
 * produce them (the relational check and the generic node differ). Carries no
 * verdict, verification tree, or counts — those are the verifier's own
 * presentation, built from the same underlying comparison.
 *
 * `TNode` is the concrete schema-IR node the `schemaDiffIssues` carry; it
 * defaults to `DiffableNode`, so this is purely additive — a caller that wants
 * the concrete node opts in (the Postgres planner uses the concrete node type),
 * everyone else keeps the default unchanged.
 */
export class SchemaDiff<TNode extends DiffableNode = DiffableNode> {
  readonly issues: readonly SchemaIssue[];
  readonly schemaDiffIssues: readonly SchemaDiffIssue<TNode>[];

  constructor(issues: readonly SchemaIssue[], schemaDiffIssues: readonly SchemaDiffIssue<TNode>[]) {
    this.issues = issues;
    this.schemaDiffIssues = schemaDiffIssues;
  }

  /** Fans `keep` across both issue lists, returning a new `SchemaDiff` narrowed to the survivors. */
  filter(keep: (issue: DiffIssue<TNode>) => boolean): SchemaDiff<TNode> {
    return new SchemaDiff(this.issues.filter(keep), this.schemaDiffIssues.filter(keep));
  }
}

/**
 * The SPI a SQL target implements to compare a contract's expected schema
 * against the introspected actual schema. How the comparison is computed —
 * relational check, generic node differ, namespace pairing — is private to
 * the implementer; verify and plan consume only the returned `SchemaDiff`.
 */
export interface SchemaDiffer<TInput> {
  diff(input: TInput): SchemaDiff;
}
