/**
 * verifySqlSchemaByDiff envelope: the family verify wraps the differ verdict
 * in the issue-based result. `ok` derives from the FAILURE lists only; a
 * warn-graded finding (an `observed`-policy subject's drift) keeps `ok: true`
 * but MUST surface in `schema.warnings` — the regression this pins is the
 * envelope silently dropping the graded warnings.
 */

import type { Contract } from '@prisma-next/contract/types';
import type { SqlDiffSchemaForVerdict } from '@prisma-next/family-sql/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { SqlColumnIR, SqlSchemaIR, SqlTableIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { verifySqlSchemaByDiff } from '../src/core/diff/schema-diff-verify';
import { createTestContract } from './schema-verify.helpers';

/** An expected flat tree whose one table is stamped with a control policy. */
function expectedRootWithPolicy(control: 'observed' | 'managed'): SqlSchemaIR {
  return new SqlSchemaIR({
    tables: {
      user: new SqlTableIR({
        name: 'user',
        columns: {
          email: new SqlColumnIR({ name: 'email', nativeType: 'text', nullable: false }),
        },
        foreignKeys: [],
        uniques: [],
        indexes: [],
        controlPolicy: control,
      }),
    },
  });
}

/**
 * A stub target diff: the live DB is missing the `user.email` column, so the
 * differ emits one `not-found` issue whose subject table carries `control`.
 */
function stubDiff(control: 'observed' | 'managed'): SqlDiffSchemaForVerdict {
  const expectedRoot = expectedRootWithPolicy(control);
  return () => ({
    issues: [
      {
        path: ['database', 'user', 'column:email'],
        reason: 'not-found',
        message: 'missing: database/user/column:email',
        expected: new SqlColumnIR({ name: 'email', nativeType: 'text', nullable: false }),
      },
    ],
    expectedRoot,
    namespacePairs: [],
  });
}

const contract = createTestContract({}) as Contract<SqlStorage>;

describe('verifySqlSchemaByDiff surfaces warnings without failing', () => {
  it('an observed subject drifts: ok stays true, the warning is carried in the envelope', () => {
    const result = verifySqlSchemaByDiff({
      contract,
      schema: new SqlSchemaIR({ tables: {} }),
      strict: false,
      frameworkComponents: [],
      diffSchemaForVerdict: stubDiff('observed'),
    });

    expect(result.ok).toBe(true);
    expect(result.schema.issues).toEqual([]);
    expect(result.schema.warnings?.issues).toHaveLength(1);
    expect(result.schema.warnings?.issues[0]?.message).toContain('column:email');
  });

  it('a managed subject drifts: it fails, and the failure is not double-counted as a warning', () => {
    const result = verifySqlSchemaByDiff({
      contract,
      schema: new SqlSchemaIR({ tables: {} }),
      strict: false,
      frameworkComponents: [],
      diffSchemaForVerdict: stubDiff('managed'),
    });

    expect(result.ok).toBe(false);
    expect(result.schema.issues).toHaveLength(1);
    expect(result.schema.warnings?.issues ?? []).toEqual([]);
  });
});
