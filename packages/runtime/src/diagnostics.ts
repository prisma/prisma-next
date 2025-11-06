export type LintSeverity = 'error' | 'warn';
export type BudgetSeverity = 'error' | 'warn';

export interface LintFinding {
  readonly code: `LINT.${string}`;
  readonly severity: LintSeverity;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export interface BudgetFinding {
  readonly code: `BUDGET.${string}`;
  readonly severity: BudgetSeverity;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export interface RuntimeDiagnostics {
  readonly lints: ReadonlyArray<LintFinding>;
  readonly budgets: ReadonlyArray<BudgetFinding>;
}

export const emptyDiagnostics: RuntimeDiagnostics = Object.freeze({
  lints: Object.freeze([]) as ReadonlyArray<LintFinding>,
  budgets: Object.freeze([]) as ReadonlyArray<BudgetFinding>,
});

export function freezeDiagnostics(diag: {
  readonly lints: ReadonlyArray<LintFinding>;
  readonly budgets: ReadonlyArray<BudgetFinding>;
}): RuntimeDiagnostics {
  const frozenLints = Object.freeze(
    diag.lints.map((finding) => Object.freeze({ ...finding })) as ReadonlyArray<LintFinding>,
  );
  const frozenBudgets = Object.freeze(
    diag.budgets.map((finding) => Object.freeze({ ...finding })) as ReadonlyArray<BudgetFinding>,
  );

  return Object.freeze({ lints: frozenLints, budgets: frozenBudgets });
}
