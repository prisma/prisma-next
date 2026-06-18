import { getPath } from '../shared/path';

export function evaluateWorkflowExpression(
  expression: string | undefined,
  state: Record<string, unknown>,
): boolean {
  if (!expression || expression.trim().length === 0) return true;
  const unquoted = stripOuterQuotes(expression.trim());
  return unquoted
    .split(/\s*\|\|\s*/)
    .some((orPart) =>
      orPart.split(/\s*&&\s*/).every((andPart) => evaluateComparison(andPart, state)),
    );
}

function evaluateComparison(expression: string, state: Record<string, unknown>): boolean {
  const match = expression.trim().match(/^(state\.[A-Za-z_][\w.]*)\s*(>=|<=|==|!=|>|<)\s*(.+)$/);
  if (!match) {
    const value = readOperand(expression.trim(), state);
    return Boolean(value);
  }
  const left = readOperand(match[1] ?? '', state);
  const right = readOperand(match[3] ?? '', state);
  const operator = match[2];
  if (typeof left === 'number' && typeof right === 'number') {
    switch (operator) {
      case '>':
        return left > right;
      case '<':
        return left < right;
      case '>=':
        return left >= right;
      case '<=':
        return left <= right;
      case '==':
        return left === right;
      case '!=':
        return left !== right;
    }
  }
  switch (operator) {
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    default:
      return false;
  }
}

function readOperand(raw: string, state: Record<string, unknown>): unknown {
  const value = stripOuterQuotes(raw.trim());
  if (value.startsWith('state.')) return getPath({ state }, value);
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function stripOuterQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
