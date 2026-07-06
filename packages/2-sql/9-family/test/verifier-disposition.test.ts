import { describe, expect, it } from 'vitest';
import {
  classifySqlVerifierIssueKind,
  verifierDisposition,
} from '../src/core/diff/verifier-disposition';

describe('classifySqlVerifierIssueKind', () => {
  it('classifies the extra nested element (column)', () => {
    expect(classifySqlVerifierIssueKind('extra_column')).toBe('extraNestedElement');
  });

  it('classifies extra auxiliaries (constraints, indexes, defaults)', () => {
    expect(classifySqlVerifierIssueKind('extra_primary_key')).toBe('extraAuxiliary');
    expect(classifySqlVerifierIssueKind('extra_foreign_key')).toBe('extraAuxiliary');
    expect(classifySqlVerifierIssueKind('extra_unique_constraint')).toBe('extraAuxiliary');
    expect(classifySqlVerifierIssueKind('extra_index')).toBe('extraAuxiliary');
    expect(classifySqlVerifierIssueKind('extra_validator')).toBe('extraAuxiliary');
    expect(classifySqlVerifierIssueKind('extra_default')).toBe('extraAuxiliary');
  });

  it('classifies the extra top-level object (table)', () => {
    expect(classifySqlVerifierIssueKind('extra_table')).toBe('extraTopLevelObject');
  });

  it('classifies declared-missing kinds', () => {
    expect(classifySqlVerifierIssueKind('missing_schema')).toBe('declaredMissing');
    expect(classifySqlVerifierIssueKind('missing_table')).toBe('declaredMissing');
    expect(classifySqlVerifierIssueKind('missing_column')).toBe('declaredMissing');
    expect(classifySqlVerifierIssueKind('type_missing')).toBe('declaredMissing');
    expect(classifySqlVerifierIssueKind('default_missing')).toBe('declaredMissing');
  });

  it('classifies value-drift kinds', () => {
    expect(classifySqlVerifierIssueKind('type_values_mismatch')).toBe('valueDrift');
    expect(classifySqlVerifierIssueKind('enum_values_changed')).toBe('valueDrift');
  });

  it('classifies declared-incompatible kinds', () => {
    expect(classifySqlVerifierIssueKind('type_mismatch')).toBe('declaredIncompatible');
    expect(classifySqlVerifierIssueKind('nullability_mismatch')).toBe('declaredIncompatible');
    expect(classifySqlVerifierIssueKind('primary_key_mismatch')).toBe('declaredIncompatible');
    expect(classifySqlVerifierIssueKind('foreign_key_mismatch')).toBe('declaredIncompatible');
    expect(classifySqlVerifierIssueKind('unique_constraint_mismatch')).toBe('declaredIncompatible');
    expect(classifySqlVerifierIssueKind('index_mismatch')).toBe('declaredIncompatible');
    expect(classifySqlVerifierIssueKind('default_mismatch')).toBe('declaredIncompatible');
  });
});

describe('verifierDisposition', () => {
  it('fails declared drift under managed', () => {
    expect(verifierDisposition('managed', 'missing_column')).toBe('fail');
    expect(verifierDisposition('managed', 'type_mismatch')).toBe('fail');
    expect(verifierDisposition('managed', 'extra_column')).toBe('fail');
    expect(verifierDisposition('managed', 'extra_index')).toBe('fail');
    expect(verifierDisposition('managed', 'extra_table')).toBe('fail');
  });

  it('suppresses extra columns only under tolerated', () => {
    expect(verifierDisposition('tolerated', 'extra_column')).toBe('suppress');
    expect(verifierDisposition('tolerated', 'missing_column')).toBe('fail');
    expect(verifierDisposition('tolerated', 'extra_index')).toBe('fail');
  });

  it('fails a type-mismatched declared column under tolerated', () => {
    expect(verifierDisposition('tolerated', 'type_mismatch')).toBe('fail');
  });

  it('suppresses extra columns, constraints, and tables under external', () => {
    expect(verifierDisposition('external', 'extra_column')).toBe('suppress');
    expect(verifierDisposition('external', 'extra_index')).toBe('suppress');
    expect(verifierDisposition('external', 'extra_table')).toBe('suppress');
    expect(verifierDisposition('external', 'type_mismatch')).toBe('fail');
    expect(verifierDisposition('external', 'missing_table')).toBe('fail');
  });

  it('warns on every kind under observed', () => {
    expect(verifierDisposition('observed', 'missing_column')).toBe('warn');
    expect(verifierDisposition('observed', 'extra_column')).toBe('warn');
    expect(verifierDisposition('observed', 'extra_index')).toBe('warn');
    expect(verifierDisposition('observed', 'extra_table')).toBe('warn');
  });

  it('treats type value drift like an external-owned detail', () => {
    expect(verifierDisposition('managed', 'enum_values_changed')).toBe('fail');
    expect(verifierDisposition('tolerated', 'enum_values_changed')).toBe('fail');
    expect(verifierDisposition('external', 'enum_values_changed')).toBe('suppress');
    expect(verifierDisposition('observed', 'enum_values_changed')).toBe('warn');
    expect(verifierDisposition('external', 'type_values_mismatch')).toBe('suppress');
  });

  it('still requires an external type to exist', () => {
    expect(verifierDisposition('external', 'type_missing')).toBe('fail');
    expect(verifierDisposition('observed', 'type_missing')).toBe('warn');
  });

  it('suppresses check_mismatch under external policy, symmetric with enum_values_changed', () => {
    // check_mismatch (value-set drift on a check constraint) is graded the same
    // as enum_values_changed — both are valueDrift so external suppresses them
    // identically. An external owner controls the allowed values; a drift should
    // not block the app.
    expect(verifierDisposition('external', 'check_mismatch')).toBe('suppress');
    expect(verifierDisposition('managed', 'check_mismatch')).toBe('fail');
    expect(verifierDisposition('tolerated', 'check_mismatch')).toBe('fail');
    expect(verifierDisposition('observed', 'check_mismatch')).toBe('warn');
  });
});
