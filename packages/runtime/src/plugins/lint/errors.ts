import { RuleVerdict } from './types';

export class GuardrailError extends Error {
  constructor(public verdict: RuleVerdict) {
    super(`[${verdict.code}] ${verdict.message}`);
    this.name = 'GuardrailError';
  }
}
