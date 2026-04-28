import type { CodecRegistry } from './codec-types';
import type { LoweredStatement } from './types';

export type AdapterTarget = string;

export interface MarkerStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

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
  /**
   * Returns the SQL statement to read the contract marker from the database.
   * Each adapter provides target-specific SQL (e.g. schema-qualified table names,
   * parameter placeholder style).
   */
  readMarkerStatement(): MarkerStatement;
}

export interface LowererContext<TContract = unknown> {
  readonly contract: TContract;
  readonly params?: readonly unknown[];
}

export type Lowerer<Ast = unknown, TContract = unknown, TBody = LoweredStatement> = (
  ast: Ast,
  context: LowererContext<TContract>,
) => TBody;

/**
 * Lowers a query AST into a target-specific executable body (typically
 * `LoweredStatement` for SQL adapters). The `lower` method returns the body
 * directly; per-statement metadata, when needed, lives on the body itself
 * (e.g. `LoweredStatement.annotations`). Adapter-level metadata such as the
 * profile id is reachable via `profile.id` for callers that genuinely need it.
 */
export interface Adapter<Ast = unknown, TContract = unknown, TBody = LoweredStatement> {
  readonly profile: AdapterProfile;
  lower(ast: Ast, context: LowererContext<TContract>): TBody;
}
