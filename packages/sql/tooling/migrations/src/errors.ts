/**
 * SQL migration planning error.
 * Family-scoped error type for migration planning failures.
 */
export class SqlMigrationPlanningError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'SqlMigrationPlanningError';
    this.code = code;
    this.details = details;
  }
}
