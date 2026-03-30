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
