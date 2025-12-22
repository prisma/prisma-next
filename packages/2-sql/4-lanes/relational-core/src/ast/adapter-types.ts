import type { CodecRegistry } from './codec-types';

export type AdapterTarget = string;

export interface AdapterProfile<TTarget extends AdapterTarget = AdapterTarget> {
  readonly id: string;
  readonly target: TTarget;
  readonly capabilities: Record<string, unknown>;
  /**
   * Returns the adapter's default codec registry.
   * The registry contains codecs provided by the adapter for converting
   * between wire types and JavaScript types.
   */
  codecs(): CodecRegistry;
}

export interface LoweredPayload<TBody = unknown> {
  readonly profileId?: string;
  readonly body: TBody;
  readonly annotations?: Record<string, unknown>;
}

export interface LowererContext<TContract = unknown> {
  readonly contract: TContract;
  readonly params?: readonly unknown[];
}

export type Lowerer<Ast = unknown, TContract = unknown, TBody = unknown> = (
  ast: Ast,
  context: LowererContext<TContract>,
) => LoweredPayload<TBody>;

export interface Adapter<Ast = unknown, TContract = unknown, TBody = unknown> {
  readonly profile: AdapterProfile;
  lower(ast: Ast, context: LowererContext<TContract>): LoweredPayload<TBody>;
}
