import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export interface PrismaContractSourceDescriptor {
  readonly kind: 'prisma';
  readonly schemaPath?: string;
  readonly schema?: string;
}

export function isPrismaContractSourceDescriptor(
  value: unknown,
): value is PrismaContractSourceDescriptor {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record['kind'] !== 'prisma') {
    return false;
  }
  const schemaPath = record['schemaPath'];
  const schema = record['schema'];
  return (
    (schemaPath === undefined || typeof schemaPath === 'string') &&
    (schema === undefined || typeof schema === 'string')
  );
}

export function looksLikePrismaSchemaText(value: string): boolean {
  return /(^|\n)\s*(datasource|generator|model|enum)\s+\w+/m.test(value);
}

export function resolvePrismaSchemaPathFromSource(
  source: unknown,
  configDir: string,
): string | undefined {
  if (isPrismaContractSourceDescriptor(source) && typeof source.schemaPath === 'string') {
    return resolve(configDir, source.schemaPath);
  }

  if (typeof source === 'string') {
    const candidatePath = isAbsolute(source) ? source : resolve(configDir, source);
    if (candidatePath.endsWith('.prisma') && existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return undefined;
}
