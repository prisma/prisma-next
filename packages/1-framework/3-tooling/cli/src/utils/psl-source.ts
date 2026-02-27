import { readFile } from 'node:fs/promises';
import {
  type ContractConfig,
  type ContractSourceValue,
  isPslContractSourceConfig,
  type PslContractSourceConfig,
} from '@prisma-next/core-control-plane/config-types';
import { dirname, isAbsolute, join, resolve } from 'pathe';

export interface ResolvedPslContractSource {
  readonly kind: 'psl';
  readonly schemaPath: string;
  readonly schema: string;
}

export type ResolvedContractSourceValue = ContractSourceValue | ResolvedPslContractSource;

export function resolvePslSchemaPath(
  source: PslContractSourceConfig,
  options?: { readonly configPath?: string },
): string {
  const baseDir = options?.configPath ? dirname(resolve(options.configPath)) : process.cwd();
  return isAbsolute(source.schemaPath) ? source.schemaPath : join(baseDir, source.schemaPath);
}

export async function resolveContractSourceValue(
  source: ContractConfig['source'],
  options?: { readonly configPath?: string },
): Promise<ResolvedContractSourceValue> {
  const sourceValue = typeof source === 'function' ? await Promise.resolve(source()) : source;
  if (!isPslContractSourceConfig(sourceValue)) {
    return sourceValue;
  }

  const schemaPath = resolvePslSchemaPath(sourceValue, options);
  const schema = await readFile(schemaPath, 'utf-8');
  return {
    kind: 'psl',
    schemaPath,
    schema,
  };
}
