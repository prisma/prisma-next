/**
 * Shared SQL utility functions for the SQLite target.
 *
 * These functions handle safe SQL identifier and literal escaping. They
 * live in `target-sqlite` (mirroring `target-postgres/src/core/sql-utils.ts`)
 * so both the control adapter (used at emit time) and the runtime adapter
 * (used at execute time) can depend on them through a single one-way edge:
 * `adapter-sqlite → target-sqlite`. Hosting them target-side avoids the
 * cyclic workspace dependency that would arise if `target-sqlite` reached
 * back into `adapter-sqlite` for these primitives.
 */

export class SqlEscapeError extends Error {
  constructor(
    message: string,
    public readonly value: string,
    public readonly kind: 'identifier' | 'literal',
  ) {
    super(message);
    this.name = 'SqlEscapeError';
  }
}

export function quoteIdentifier(identifier: string): string {
  if (identifier.length === 0) {
    throw new SqlEscapeError('Identifier cannot be empty', identifier, 'identifier');
  }
  if (identifier.includes('\0')) {
    throw new SqlEscapeError(
      'Identifier cannot contain null bytes',
      identifier.replace(/\0/g, '\\0'),
      'identifier',
    );
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function escapeLiteral(value: string): string {
  if (value.includes('\0')) {
    throw new SqlEscapeError(
      'Literal value cannot contain null bytes',
      value.replace(/\0/g, '\\0'),
      'literal',
    );
  }
  return value.replace(/'/g, "''");
}
