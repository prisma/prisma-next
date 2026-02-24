import type { CompiledQuery } from 'kysely';

export function shiftParameterPlaceholders(sqlText: string, parameterOffset: number): string {
  if (parameterOffset === 0) {
    return sqlText;
  }

  return sqlText.replace(/\$(\d+)/g, (_full, group) => {
    const index = Number(group);
    return `$${index + parameterOffset}`;
  });
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function toRawCompiledQuery<Row>(
  sqlText: string,
  parameters: readonly unknown[],
): CompiledQuery<Row> {
  return {
    sql: sqlText,
    parameters: [...parameters],
  } as unknown as CompiledQuery<Row>;
}
