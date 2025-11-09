import { describe, expect, it } from 'vitest';
import type { BudgetFinding, LintFinding } from '../src/diagnostics';
import { emptyDiagnostics, freezeDiagnostics } from '../src/diagnostics';

describe('diagnostics', () => {
  describe('emptyDiagnostics', () => {
    it('returns frozen empty arrays', () => {
      expect(emptyDiagnostics.lints).toEqual([]);
      expect(emptyDiagnostics.budgets).toEqual([]);
      expect(Object.isFrozen(emptyDiagnostics)).toBe(true);
      expect(Object.isFrozen(emptyDiagnostics.lints)).toBe(true);
      expect(Object.isFrozen(emptyDiagnostics.budgets)).toBe(true);
    });
  });

  describe('freezeDiagnostics', () => {
    it('freezes empty diagnostics', () => {
      const result = freezeDiagnostics({ lints: [], budgets: [] });

      expect(result.lints).toEqual([]);
      expect(result.budgets).toEqual([]);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.lints)).toBe(true);
      expect(Object.isFrozen(result.budgets)).toBe(true);
    });

    it('freezes diagnostics with lints', () => {
      const lint: LintFinding = {
        code: 'LINT.TEST',
        severity: 'error',
        message: 'Test lint',
      };

      const result = freezeDiagnostics({ lints: [lint], budgets: [] });

      expect(result).toMatchObject({
        lints: [lint],
        budgets: [],
      });
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.lints)).toBe(true);
      expect(Object.isFrozen(result.lints[0])).toBe(true);
      expect(Object.isFrozen(result.budgets)).toBe(true);
    });

    it('freezes diagnostics with budgets', () => {
      const budget: BudgetFinding = {
        code: 'BUDGET.TEST',
        severity: 'warn',
        message: 'Test budget',
      };

      const result = freezeDiagnostics({ lints: [], budgets: [budget] });

      expect(result).toMatchObject({
        lints: [],
        budgets: [budget],
      });
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.lints)).toBe(true);
      expect(Object.isFrozen(result.budgets)).toBe(true);
      expect(Object.isFrozen(result.budgets[0])).toBe(true);
    });

    it('freezes diagnostics with multiple findings', () => {
      const lint1: LintFinding = {
        code: 'LINT.TEST1',
        severity: 'error',
        message: 'Test lint 1',
      };

      const lint2: LintFinding = {
        code: 'LINT.TEST2',
        severity: 'warn',
        message: 'Test lint 2',
        details: { key: 'value' },
      };

      const budget1: BudgetFinding = {
        code: 'BUDGET.TEST1',
        severity: 'error',
        message: 'Test budget 1',
      };

      const budget2: BudgetFinding = {
        code: 'BUDGET.TEST2',
        severity: 'warn',
        message: 'Test budget 2',
        details: { count: 42 },
      };

      const result = freezeDiagnostics({
        lints: [lint1, lint2],
        budgets: [budget1, budget2],
      });

      expect(result).toMatchObject({
        lints: [lint1, lint2],
        budgets: [budget1, budget2],
      });
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.lints)).toBe(true);
      expect(Object.isFrozen(result.budgets)).toBe(true);
      expect(Object.isFrozen(result.lints[0])).toBe(true);
      expect(Object.isFrozen(result.lints[1])).toBe(true);
      expect(Object.isFrozen(result.budgets[0])).toBe(true);
      expect(Object.isFrozen(result.budgets[1])).toBe(true);
    });

    it('creates new objects for findings', () => {
      const lint: LintFinding = {
        code: 'LINT.TEST',
        severity: 'error',
        message: 'Test lint',
      };

      const budget: BudgetFinding = {
        code: 'BUDGET.TEST',
        severity: 'warn',
        message: 'Test budget',
      };

      const input = { lints: [lint], budgets: [budget] };
      const result = freezeDiagnostics(input);

      expect(result.lints[0]).not.toBe(input.lints[0]);
      expect(result.budgets[0]).not.toBe(input.budgets[0]);
      expect(result).toMatchObject({
        lints: [input.lints[0]],
        budgets: [input.budgets[0]],
      });
    });
  });
});
