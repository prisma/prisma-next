import { RuntimePlugin } from '../../plugin';
import { Schema } from '@prisma/relational-ir';
import { Plan } from '@prisma/sql';
import { noSelectStar } from './rules/no-select-star';
import { mutationRequiresWhere } from './rules/mutation-requires-where';
import { noMissingLimit } from './rules/no-missing-limit';
import { noUnindexedColumnInWhere } from './rules/no-unindexed-column-in-where';
import { RuleConfig } from './types';
import { GuardrailError } from './errors';

const DEFAULT_RULES = [
  noSelectStar,
  mutationRequiresWhere,
  noMissingLimit,
  noUnindexedColumnInWhere,
];

export function lint(config: { rules: RuleConfig }): RuntimePlugin {
  const activeRules = DEFAULT_RULES.filter((rule) => {
    const level = config.rules[rule.id];
    return level && level !== 'off';
  });

  return {
    async beforeExecute({ plan, ir }) {
      for (const rule of activeRules) {
        const verdict = rule.check(plan, ir);
        if (verdict) {
          const configuredLevel = config.rules[rule.id];
          const effectiveVerdict = { ...verdict, level: configuredLevel };

          if (effectiveVerdict.level === 'error') {
            throw new GuardrailError(effectiveVerdict);
          } else if (effectiveVerdict.level === 'warn') {
            console.warn(`[${effectiveVerdict.code}] ${effectiveVerdict.message}`);
          }
        }
      }
    },
  };
}

export { noSelectStar, mutationRequiresWhere, noMissingLimit, noUnindexedColumnInWhere };
export type { LintRule, RuleConfig, RuleVerdict, RuleLevel } from './types';
export { GuardrailError } from './errors';
