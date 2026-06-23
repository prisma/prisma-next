import { loadConfig } from '@prisma-next/config-loader';
import { createControlStack } from '@prisma-next/framework-components/control';
import type { FormatOptions } from '@prisma-next/psl-parser/format';
import type { PipelineInputs } from './pipeline';
import { hasPslInputs, resolveSchemaInputs, type SchemaInputSet } from './schema-inputs';

export const CONFIG_FILENAME = 'prisma-next.config.ts';

type LoadedConfig = Awaited<ReturnType<typeof loadConfig>>;

export interface ConfigResolution {
  readonly inputs: SchemaInputSet;
  readonly formatter?: FormatOptions;
  readonly controlStack: PipelineInputs;
}

const emptyPipelineInputs: PipelineInputs = {
  scalarTypes: [],
  pslBlockDescriptors: {},
};

export async function resolveConfigInputs(configPath: string): Promise<ConfigResolution> {
  const config = await loadConfig(configPath);
  const inputs = resolveSchemaInputs(config);
  const controlStack = resolveControlStackInputs(config) ?? emptyPipelineInputs;
  return config.formatter === undefined
    ? { inputs, controlStack }
    : { inputs, formatter: config.formatter, controlStack };
}

export function resolveControlStackInputs(config: LoadedConfig): PipelineInputs | undefined {
  if (!hasPslInputs(config)) {
    return undefined;
  }
  const stack = createControlStack(config);
  return {
    scalarTypes: [...stack.scalarTypeDescriptors.keys()],
    pslBlockDescriptors: stack.authoringContributions.pslBlockDescriptors,
  };
}
