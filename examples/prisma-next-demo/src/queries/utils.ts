export async function collect<T>(iterator: AsyncIterable<T>): Promise<T[]> {
  const rows: T[] = [];
  for await (const row of iterator) {
    rows.push(row);
  }
  return rows;
}
