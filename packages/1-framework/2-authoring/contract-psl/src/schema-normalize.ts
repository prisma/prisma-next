/**
 * Prisma 7 no longer supports datasource URLs in schema files.
 * For compatibility with existing schemas, strip these lines before parsing.
 */
export function sanitizePrismaSchemaForPrisma7(schema: string): string {
  const lines = schema.split(/\r?\n/);
  const output: string[] = [];

  let inDatasourceBlock = false;
  let datasourceBraceDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!inDatasourceBlock && /^datasource\s+\w+\s*\{/.test(trimmed)) {
      inDatasourceBlock = true;
      datasourceBraceDepth = countBraceDelta(line);
      output.push(line);
      continue;
    }

    if (inDatasourceBlock) {
      if (/^(url|directUrl|shadowDatabaseUrl)\s*=/.test(trimmed)) {
        datasourceBraceDepth += countBraceDelta(line);
        if (datasourceBraceDepth <= 0) {
          inDatasourceBlock = false;
          datasourceBraceDepth = 0;
        }
        continue;
      }

      datasourceBraceDepth += countBraceDelta(line);
      output.push(line);

      if (datasourceBraceDepth <= 0) {
        inDatasourceBlock = false;
        datasourceBraceDepth = 0;
      }
      continue;
    }

    output.push(line);
  }

  return output.join('\n');
}

function countBraceDelta(line: string): number {
  let delta = 0;
  for (const ch of line) {
    if (ch === '{') {
      delta += 1;
    } else if (ch === '}') {
      delta -= 1;
    }
  }
  return delta;
}
