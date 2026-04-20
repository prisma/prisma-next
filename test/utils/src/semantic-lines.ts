export function countSemanticLines(source: string): number {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, '');

  return withoutBlockComments
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => line.length > 0).length;
}
