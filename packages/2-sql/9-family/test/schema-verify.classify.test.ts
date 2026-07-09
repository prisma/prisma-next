import type {
  DiffableNode,
  SchemaDiffIssue,
  SchemaSubjectGranularity,
} from '@prisma-next/framework-components/control';
import {
  SqlCheckConstraintIR,
  SqlColumnIR,
  SqlIndexIR,
  SqlTableIR,
} from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { classifySqlDiffIssue, computeSqlDiffVerdict } from '../src/core/diff/schema-verify';

/**
 * Classification and strict gating key on the issue's stamped
 * {@link SchemaSubjectGranularity} — never on a `nodeKind` naming convention
 * and never on anything read off the node. Each fixture stamps the
 * granularity directly, the way the target's differ does when it produces the
 * issue.
 */
const table = new SqlTableIR({ name: 't', columns: {}, foreignKeys: [], uniques: [], indexes: [] });
const column = new SqlColumnIR({ name: 'c', nativeType: 'int4', nullable: false });
const index = new SqlIndexIR({ columns: ['c'], unique: false });
const check = new SqlCheckConstraintIR({ name: 'chk', column: 'c', permittedValues: ['a'] });

function issueOf(
  reason: 'not-expected' | 'not-found' | 'not-equal',
  node: DiffableNode,
  granularity?: SchemaSubjectGranularity,
): SchemaDiffIssue {
  return {
    path: ['database', node.id],
    reason,
    message: `${reason}: ${node.id}`,
    ...(granularity !== undefined ? { subjectGranularity: granularity } : {}),
    ...(reason === 'not-expected' ? { actual: node } : { expected: node, actual: node }),
  };
}

describe('classifySqlDiffIssue keys on subject granularity', () => {
  it('not-found is declaredMissing for every granularity', () => {
    expect(classifySqlDiffIssue(issueOf('not-found', table, 'entity'))).toBe('declaredMissing');
    expect(classifySqlDiffIssue(issueOf('not-found', index, 'auxiliary'))).toBe('declaredMissing');
    expect(classifySqlDiffIssue(issueOf('not-found', table, 'namespace'))).toBe('declaredMissing');
  });

  it.each([
    ['entity granularity', 'entity', 'extraTopLevelObject'],
    ['namespace granularity', 'namespace', 'extraTopLevelObject'],
    ['field granularity', 'field', 'extraNestedElement'],
    ['auxiliary granularity', 'auxiliary', 'extraAuxiliary'],
    ['structural granularity', 'structural', 'extraAuxiliary'],
  ] as const)('not-expected with %s classifies as %s', (_label, granularity, category) => {
    expect(classifySqlDiffIssue(issueOf('not-expected', table, granularity))).toBe(category);
  });

  it('not-equal on a check node is valueDrift; on any other node declaredIncompatible', () => {
    expect(classifySqlDiffIssue(issueOf('not-equal', check, 'auxiliary'))).toBe('valueDrift');
    expect(classifySqlDiffIssue(issueOf('not-equal', column, 'field'))).toBe(
      'declaredIncompatible',
    );
  });
});

describe('strict gating keys on subject granularity', () => {
  function verdictFor(granularity: SchemaSubjectGranularity, strict: boolean) {
    return computeSqlDiffVerdict({
      issues: [issueOf('not-expected', table, granularity)],
      resolveControlPolicy: () => undefined,
      strict,
      defaultControlPolicy: undefined,
    });
  }

  it.each([
    ['namespace'],
    ['entity'],
    ['field'],
    ['auxiliary'],
  ] as const)('a not-expected %s extra is strict-only', (granularity) => {
    expect(verdictFor(granularity, true).failures).toHaveLength(1);
    expect(verdictFor(granularity, false).failures).toHaveLength(0);
  });

  it('a not-expected structural extra fails in both modes', () => {
    expect(verdictFor('structural', true).failures).toHaveLength(1);
    expect(verdictFor('structural', false).failures).toHaveLength(1);
  });
});
