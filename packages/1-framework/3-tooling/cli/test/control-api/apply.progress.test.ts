import { describe, expect, it } from 'vitest';
import { progressLabelForAction } from '../../src/control-api/operations/apply';

describe('progressLabelForAction', () => {
  it('returns an init-specific label for dbInit', () => {
    expect(progressLabelForAction('dbInit')).toBe('Initialising database across spaces');
  });

  it('returns an update-specific label for dbUpdate', () => {
    expect(progressLabelForAction('dbUpdate')).toBe('Updating database across spaces');
  });

  it('returns the migration-apply label for migrationApply', () => {
    expect(progressLabelForAction('migrationApply')).toBe('Applying migration plan across spaces');
  });
});
