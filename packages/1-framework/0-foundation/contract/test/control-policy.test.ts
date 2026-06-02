import { describe, expect, it } from 'vitest';
import { effectiveControlPolicy, verifierDisposition } from '../src/control-policy';

describe('effectiveControlPolicy', () => {
  describe('precedence: node → default → managed', () => {
    it('returns the node value when both node and default are set', () => {
      expect(effectiveControlPolicy('tolerated', 'external')).toBe('tolerated');
    });

    it('returns the default value when node is undefined', () => {
      expect(effectiveControlPolicy(undefined, 'external')).toBe('external');
    });

    it('returns managed when both are undefined', () => {
      expect(effectiveControlPolicy(undefined, undefined)).toBe('managed');
    });
  });

  describe('each policy value resolves through', () => {
    it('resolves managed via node', () => {
      expect(effectiveControlPolicy('managed', undefined)).toBe('managed');
    });

    it('resolves tolerated via node', () => {
      expect(effectiveControlPolicy('tolerated', undefined)).toBe('tolerated');
    });

    it('resolves external via node', () => {
      expect(effectiveControlPolicy('external', undefined)).toBe('external');
    });

    it('resolves observed via node', () => {
      expect(effectiveControlPolicy('observed', undefined)).toBe('observed');
    });

    it('resolves managed via default', () => {
      expect(effectiveControlPolicy(undefined, 'managed')).toBe('managed');
    });

    it('resolves tolerated via default', () => {
      expect(effectiveControlPolicy(undefined, 'tolerated')).toBe('tolerated');
    });

    it('resolves external via default', () => {
      expect(effectiveControlPolicy(undefined, 'external')).toBe('external');
    });

    it('resolves observed via default', () => {
      expect(effectiveControlPolicy(undefined, 'observed')).toBe('observed');
    });
  });
});

describe('verifierDisposition', () => {
  it('fails declared drift under managed', () => {
    expect(verifierDisposition('managed', 'missing_column')).toBe('fail');
    expect(verifierDisposition('managed', 'type_mismatch')).toBe('fail');
    expect(verifierDisposition('managed', 'extra_column')).toBe('fail');
    expect(verifierDisposition('managed', 'extra_index')).toBe('fail');
  });

  it('suppresses extra columns only under tolerated', () => {
    expect(verifierDisposition('tolerated', 'extra_column')).toBe('suppress');
    expect(verifierDisposition('tolerated', 'missing_column')).toBe('fail');
    expect(verifierDisposition('tolerated', 'extra_index')).toBe('fail');
  });

  it('suppresses extra columns and constraints under external', () => {
    expect(verifierDisposition('external', 'extra_column')).toBe('suppress');
    expect(verifierDisposition('external', 'extra_index')).toBe('suppress');
    expect(verifierDisposition('external', 'type_mismatch')).toBe('fail');
    expect(verifierDisposition('external', 'missing_table')).toBe('fail');
  });

  it('warns on every kind under observed', () => {
    expect(verifierDisposition('observed', 'missing_column')).toBe('warn');
    expect(verifierDisposition('observed', 'extra_column')).toBe('warn');
    expect(verifierDisposition('observed', 'extra_index')).toBe('warn');
  });
});
