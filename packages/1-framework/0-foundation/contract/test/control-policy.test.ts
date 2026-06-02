import { describe, expect, it } from 'vitest';
import { effectiveControl } from '../src/control-policy';

describe('effectiveControl', () => {
  describe('precedence: node → default → managed', () => {
    it('returns the node value when both node and default are set', () => {
      expect(effectiveControl('tolerated', 'external')).toBe('tolerated');
    });

    it('returns the default value when node is undefined', () => {
      expect(effectiveControl(undefined, 'external')).toBe('external');
    });

    it('returns managed when both are undefined', () => {
      expect(effectiveControl(undefined, undefined)).toBe('managed');
    });
  });

  describe('each policy value resolves through', () => {
    it('resolves managed via node', () => {
      expect(effectiveControl('managed', undefined)).toBe('managed');
    });

    it('resolves tolerated via node', () => {
      expect(effectiveControl('tolerated', undefined)).toBe('tolerated');
    });

    it('resolves external via node', () => {
      expect(effectiveControl('external', undefined)).toBe('external');
    });

    it('resolves observed via node', () => {
      expect(effectiveControl('observed', undefined)).toBe('observed');
    });

    it('resolves managed via default', () => {
      expect(effectiveControl(undefined, 'managed')).toBe('managed');
    });

    it('resolves tolerated via default', () => {
      expect(effectiveControl(undefined, 'tolerated')).toBe('tolerated');
    });

    it('resolves external via default', () => {
      expect(effectiveControl(undefined, 'external')).toBe('external');
    });

    it('resolves observed via default', () => {
      expect(effectiveControl(undefined, 'observed')).toBe('observed');
    });
  });
});
