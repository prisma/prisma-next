import { Plan } from '@prisma/sql';
import { Schema } from '@prisma/relational-ir';

export type RuleLevel = 'error' | 'warn' | 'off';

export interface RuleVerdict {
  level: RuleLevel;
  code: string;
  message: string;
}

export interface LintRule {
  id: string;
  check(plan: Plan, ir: Schema): RuleVerdict | null;
}

export type RuleConfig = Record<string, RuleLevel>;
