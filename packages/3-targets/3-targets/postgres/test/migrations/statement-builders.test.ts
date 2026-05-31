import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import { describe, expect, test } from 'vitest';
import { buildMergeMarkerStatements } from '../../src/core/migrations/statement-builders';

describe('buildMergeMarkerStatements', () => {
  test('keys the upsert by `space` and binds the caller-supplied app space', () => {
    const stmts = buildMergeMarkerStatements({
      space: APP_SPACE_ID,
      storageHash: 'sha256:dest',
      profileHash: 'sha256:profile',
      invariants: [],
    });
    expect(stmts.insert.sql).toMatch(/\(\s*space\b/);
    expect(stmts.insert.sql).not.toMatch(/\bid\b/);
    expect(stmts.update.sql).toMatch(/where space = \$1/i);
    expect(stmts.insert.params[0]).toBe(APP_SPACE_ID);
    expect(stmts.update.params[0]).toBe(APP_SPACE_ID);
  });

  test('honours a caller-supplied `space` value', () => {
    const stmts = buildMergeMarkerStatements({
      space: 'cipherstash',
      storageHash: 'sha256:dest',
      profileHash: 'sha256:profile',
      invariants: [],
    });
    expect(stmts.insert.params[0]).toBe('cipherstash');
    expect(stmts.update.params[0]).toBe('cipherstash');
  });
});
