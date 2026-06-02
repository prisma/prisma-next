import { describe, expect, it } from 'vitest';
import {
  classifyMongoVerifierIssueKind,
  verifierDisposition,
} from '../src/core/schema-verify/verifier-disposition';

describe('classifyMongoVerifierIssueKind', () => {
  it('classifies the extra top-level object (collection)', () => {
    expect(classifyMongoVerifierIssueKind('extra_table')).toBe('extraTopLevelObject');
  });

  it('classifies extra auxiliaries (indexes, validators)', () => {
    expect(classifyMongoVerifierIssueKind('extra_index')).toBe('extraAuxiliary');
    expect(classifyMongoVerifierIssueKind('extra_validator')).toBe('extraAuxiliary');
  });

  it('classifies declared-missing kinds (collection, validator)', () => {
    expect(classifyMongoVerifierIssueKind('missing_table')).toBe('declaredMissing');
    expect(classifyMongoVerifierIssueKind('type_missing')).toBe('declaredMissing');
  });

  it('classifies declared-incompatible kinds (index, validator/options mismatch)', () => {
    expect(classifyMongoVerifierIssueKind('index_mismatch')).toBe('declaredIncompatible');
    expect(classifyMongoVerifierIssueKind('type_mismatch')).toBe('declaredIncompatible');
  });
});

describe('verifierDisposition', () => {
  it('fails declared drift and extras under managed', () => {
    expect(verifierDisposition('managed', 'missing_table')).toBe('fail');
    expect(verifierDisposition('managed', 'type_missing')).toBe('fail');
    expect(verifierDisposition('managed', 'type_mismatch')).toBe('fail');
    expect(verifierDisposition('managed', 'index_mismatch')).toBe('fail');
    expect(verifierDisposition('managed', 'extra_index')).toBe('fail');
    expect(verifierDisposition('managed', 'extra_validator')).toBe('fail');
    expect(verifierDisposition('managed', 'extra_table')).toBe('fail');
  });

  it('fails extra auxiliaries under tolerated (no nested element on Mongo)', () => {
    expect(verifierDisposition('tolerated', 'extra_index')).toBe('fail');
    expect(verifierDisposition('tolerated', 'extra_validator')).toBe('fail');
    expect(verifierDisposition('tolerated', 'extra_table')).toBe('fail');
    expect(verifierDisposition('tolerated', 'missing_table')).toBe('fail');
    expect(verifierDisposition('tolerated', 'type_mismatch')).toBe('fail');
  });

  it('suppresses extras under external, still fails declared drift', () => {
    expect(verifierDisposition('external', 'extra_index')).toBe('suppress');
    expect(verifierDisposition('external', 'extra_validator')).toBe('suppress');
    expect(verifierDisposition('external', 'extra_table')).toBe('suppress');
    expect(verifierDisposition('external', 'missing_table')).toBe('fail');
    expect(verifierDisposition('external', 'type_missing')).toBe('fail');
    expect(verifierDisposition('external', 'index_mismatch')).toBe('fail');
    expect(verifierDisposition('external', 'type_mismatch')).toBe('fail');
  });

  it('warns on every emitted kind under observed', () => {
    expect(verifierDisposition('observed', 'missing_table')).toBe('warn');
    expect(verifierDisposition('observed', 'extra_table')).toBe('warn');
    expect(verifierDisposition('observed', 'extra_index')).toBe('warn');
    expect(verifierDisposition('observed', 'extra_validator')).toBe('warn');
    expect(verifierDisposition('observed', 'type_missing')).toBe('warn');
    expect(verifierDisposition('observed', 'index_mismatch')).toBe('warn');
    expect(verifierDisposition('observed', 'type_mismatch')).toBe('warn');
  });
});
