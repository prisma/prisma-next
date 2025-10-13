// Main convenience export - re-exports everything
export * from './connection';
export { verifyContract, assertContract } from '../contract-verifier';
export type { ContractVerifierOptions, ContractVerification } from '../contract-verifier';

export { Runtime, createRuntime } from '../runtime';
export type {
  RuntimePlugin,
  BeforeExecuteContext,
  AfterExecuteContext,
  ErrorContext,
  QueryMetrics,
  RuntimeConfig,
} from '../plugin';
export { lint } from '../plugins/lint';
export type { LintRule, RuleConfig, RuleVerdict, RuleLevel } from '../plugins/lint';
export { GuardrailError } from '../plugins/lint';
