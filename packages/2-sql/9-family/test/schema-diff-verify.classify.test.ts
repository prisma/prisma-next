import type { DiffableNode, SchemaDiffIssue } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import type { SqlSchemaDiffRole } from '@prisma-next/sql-schema-ir/types';
import {
  SqlCheckConstraintIR,
  SqlColumnIR,
  SqlIndexIR,
  SqlSchemaIR,
  SqlSchemaIRNode,
  SqlTableIR,
} from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { classifySqlDiffIssue, computeSqlDiffVerdict } from '../src/core/diff/schema-diff-verify';

/**
 * Classification and strict gating key on the node's DECLARED `diffRole`,
 * never on a `nodeKind` naming convention. This test node deliberately
 * carries a nodeKind that matches no naming pattern — behavior must come
 * from the role alone.
 */
class UnconventionallyNamedNode extends SqlSchemaIRNode implements DiffableNode {
  override readonly nodeKind = 'weirdly:named/kind';
  readonly #role: SqlSchemaDiffRole;

  constructor(role: SqlSchemaDiffRole) {
    super();
    this.#role = role;
    freezeNode(this);
  }

  override get diffRole(): SqlSchemaDiffRole {
    return this.#role;
  }

  get id(): string {
    return 'weird';
  }

  isEqualTo(other: DiffableNode): boolean {
    return this.id === other.id;
  }

  children(): readonly DiffableNode[] {
    return [];
  }
}

const table = new SqlTableIR({ name: 't', columns: {}, foreignKeys: [], uniques: [], indexes: [] });
const column = new SqlColumnIR({ name: 'c', nativeType: 'int4', nullable: false });
const index = new SqlIndexIR({ columns: ['c'], unique: false });
const check = new SqlCheckConstraintIR({ name: 'chk', column: 'c', permittedValues: ['a'] });

function issueOf(
  reason: 'not-expected' | 'not-found' | 'not-equal',
  node: DiffableNode,
): SchemaDiffIssue {
  return {
    path: ['database', node.id],
    reason,
    message: `${reason}: ${node.id}`,
    ...(reason === 'not-expected' ? { actual: node } : { expected: node, actual: node }),
  };
}

describe('classifySqlDiffIssue keys on diffRole', () => {
  it('not-found is declaredMissing for every role', () => {
    expect(classifySqlDiffIssue(issueOf('not-found', table))).toBe('declaredMissing');
    expect(classifySqlDiffIssue(issueOf('not-found', index))).toBe('declaredMissing');
    expect(
      classifySqlDiffIssue(issueOf('not-found', new UnconventionallyNamedNode('namespace'))),
    ).toBe('declaredMissing');
  });

  it.each([
    ['table role', table, 'extraTopLevelObject'],
    ['namespace role', new UnconventionallyNamedNode('namespace'), 'extraTopLevelObject'],
    ['column role', column, 'extraNestedElement'],
    ['auxiliary role', index, 'extraAuxiliary'],
    ['structural role', new UnconventionallyNamedNode('structural'), 'extraAuxiliary'],
  ] as const)('not-expected with %s classifies as %s', (_label, node, category) => {
    expect(classifySqlDiffIssue(issueOf('not-expected', node))).toBe(category);
  });

  it('not-equal on a check node is valueDrift; on any other node declaredIncompatible', () => {
    expect(classifySqlDiffIssue(issueOf('not-equal', check))).toBe('valueDrift');
    expect(classifySqlDiffIssue(issueOf('not-equal', column))).toBe('declaredIncompatible');
  });
});

describe('strict gating keys on diffRole', () => {
  const expectedRoot = new SqlSchemaIR({ tables: {} });

  function verdictFor(node: DiffableNode, strict: boolean) {
    return computeSqlDiffVerdict({
      issues: [issueOf('not-expected', node)],
      expectedRoot,
      strict,
      defaultControlPolicy: undefined,
    });
  }

  it.each([
    ['table role', table],
    ['namespace role', new UnconventionallyNamedNode('namespace')],
    ['column role', column],
    ['auxiliary role', index],
  ] as const)('a not-expected %s extra is strict-only', (_label, node) => {
    expect(verdictFor(node, true).failures).toHaveLength(1);
    expect(verdictFor(node, false).failures).toHaveLength(0);
  });

  it('a not-expected structural extra fails in both modes', () => {
    const node = new UnconventionallyNamedNode('structural');
    expect(verdictFor(node, true).failures).toHaveLength(1);
    expect(verdictFor(node, false).failures).toHaveLength(1);
  });
});
