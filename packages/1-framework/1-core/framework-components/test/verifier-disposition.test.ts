import { describe, expect, it } from 'vitest';
import {
  classifyVerifierIssueKind,
  verifierDisposition,
} from '../src/control/verifier-disposition';

describe('classifyVerifierIssueKind', () => {
  it('classifies extra-column, extra-constraint, and extra-table kinds', () => {
    expect(classifyVerifierIssueKind('extra_column')).toBe('extraColumn');
    expect(classifyVerifierIssueKind('extra_index')).toBe('extraConstraint');
    expect(classifyVerifierIssueKind('extra_table')).toBe('extraTable');
  });

  it('classifies declared-missing and type-value-drift kinds', () => {
    expect(classifyVerifierIssueKind('missing_column')).toBe('declaredMissing');
    expect(classifyVerifierIssueKind('type_missing')).toBe('declaredMissing');
    expect(classifyVerifierIssueKind('enum_values_changed')).toBe('typeValueDrift');
    expect(classifyVerifierIssueKind('type_values_mismatch')).toBe('typeValueDrift');
  });

  it('classifies shape divergences as declaredIncompatible', () => {
    expect(classifyVerifierIssueKind('type_mismatch')).toBe('declaredIncompatible');
    expect(classifyVerifierIssueKind('nullability_mismatch')).toBe('declaredIncompatible');
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
});
