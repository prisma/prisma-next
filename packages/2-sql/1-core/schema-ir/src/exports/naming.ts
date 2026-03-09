export function defaultIndexName(tableName: string, columns: readonly string[]): string {
  return `${tableName}_${columns.join('_')}_idx`;
}
