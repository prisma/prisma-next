import type {
  DiffableNode,
  DiffSubjectGranularity,
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
 * Classification and strict gating key on the granularity a `granularityOf`
 * classifier resolves from the issue's node `nodeKind` — never on a
 * `nodeKind` naming convention and never on anything stamped on the issue or
 * the node. Each fixture's classifier ignores the real node kind and returns
 * whatever granularity the test wants to exercise, decoupling "which
 * granularity classifies as what" from "which real node maps to which
 * granularity" (pinned separately by the relational/Postgres node-kind maps).
 */
const table = new SqlTableIR({ name: 't', columns: {}, foreignKeys: [], uniques: [], indexes: [] });
const column = new SqlColumnIR({ name: 'c', nativeType: 'int4', nullable: false });
const index = new SqlIndexIR({ columns: ['c'], unique: false });
const check = new SqlCheckConstraintIR({ name: 'chk', column: 'c', permittedValues: ['a'] });

function issueOf(reason: 'not-expected' | 'not-found' | 'not-equal', node: DiffableNode) {
  return {
    path: ['database', node.id],
    reason,
    message: `${reason}: ${node.id}`,
    ...(reason === 'not-expected' ? { actual: node } : { expected: node, actual: node }),
  };
}

/** A `granularityOf` classifier that always resolves to `granularity`, regardless of `nodeKind`. */
function fixedGranularity(
  granularity: DiffSubjectGranularity,
): (nodeKind: string) => DiffSubjectGranularity {
  return () => granularity;
}

describe('classifySqlDiffIssue keys on subject granularity', () => {
  it('not-found is declaredMissing for every granularity', () => {
    expect(classifySqlDiffIssue(issueOf('not-found', table), fixedGranularity('entity'))).toBe(
      'declaredMissing',
    );
    expect(classifySqlDiffIssue(issueOf('not-found', index), fixedGranularity('auxiliary'))).toBe(
      'declaredMissing',
    );
    expect(classifySqlDiffIssue(issueOf('not-found', table), fixedGranularity('namespace'))).toBe(
      'declaredMissing',
    );
  });

  it.each([
    ['entity granularity', 'entity', 'extraTopLevelObject'],
    ['namespace granularity', 'namespace', 'extraTopLevelObject'],
    ['field granularity', 'field', 'extraNestedElement'],
    ['auxiliary granularity', 'auxiliary', 'extraAuxiliary'],
    ['structural granularity', 'structural', 'extraAuxiliary'],
  ] as const)('not-expected with %s classifies as %s', (_label, granularity, category) => {
    expect(
      classifySqlDiffIssue(issueOf('not-expected', table), fixedGranularity(granularity)),
    ).toBe(category);
  });

  it('not-equal on a check node is valueDrift; on any other node declaredIncompatible', () => {
    expect(classifySqlDiffIssue(issueOf('not-equal', check), fixedGranularity('auxiliary'))).toBe(
      'valueDrift',
    );
    expect(classifySqlDiffIssue(issueOf('not-equal', column), fixedGranularity('field'))).toBe(
      'declaredIncompatible',
    );
  });

  it('a target isValueDriftNode predicate routes a paired mismatch to valueDrift (target value-set kinds)', () => {
    const isValueDrift = (nodeKind: string) => nodeKind === table.nodeKind;
    expect(
      classifySqlDiffIssue(issueOf('not-equal', table), fixedGranularity('entity'), isValueDrift),
    ).toBe('valueDrift');
    expect(
      classifySqlDiffIssue(issueOf('not-equal', column), fixedGranularity('field'), isValueDrift),
    ).toBe('declaredIncompatible');
  });

  it('the predicate only affects paired mismatches — not-found and not-expected keep their categories', () => {
    const alwaysValueDrift = () => true;
    expect(
      classifySqlDiffIssue(
        issueOf('not-found', table),
        fixedGranularity('entity'),
        alwaysValueDrift,
      ),
    ).toBe('declaredMissing');
    expect(
      classifySqlDiffIssue(
        issueOf('not-expected', table),
        fixedGranularity('entity'),
        alwaysValueDrift,
      ),
    ).toBe('extraTopLevelObject');
  });
});

describe('strict gating keys on subject granularity', () => {
  function verdictFor(granularity: DiffSubjectGranularity, strict: boolean) {
    return computeSqlDiffVerdict({
      issues: [issueOf('not-expected', table)],
      resolveControlPolicy: () => undefined,
      strict,
      defaultControlPolicy: undefined,
      granularityOf: fixedGranularity(granularity),
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
