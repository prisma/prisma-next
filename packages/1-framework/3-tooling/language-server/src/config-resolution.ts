import type { ContractSourceContext } from '@prisma-next/config/config-types';
import { loadConfig, type PrismaNextConfig } from '@prisma-next/config-loader';
import type { ControlStack } from '@prisma-next/framework-components/control';
import { createControlStack } from '@prisma-next/framework-components/control';
import type { FormatOptions } from '@prisma-next/psl-parser/format';
import { hasPslInterpreter, type PslInterpretCapable } from '@prisma-next/psl-parser/interpret';
import type { PipelineInputs } from './pipeline';
import { hasPslInputs, resolveSchemaInputs, type SchemaInputSet } from './schema-inputs';

export const CONFIG_FILENAME = 'prisma-next.config.ts';

export interface ProjectInterpretation {
  readonly source: PslInterpretCapable;
  readonly context: ContractSourceContext;
}

export interface ConfigResolution {
  readonly inputs: SchemaInputSet;
  readonly formatter?: FormatOptions;
  readonly controlStack: PipelineInputs;
  readonly interpretation?: ProjectInterpretation;
}

const emptyPipelineInputs: PipelineInputs = {
  scalarTypes: [],
  pslBlockDescriptors: {},
};

export async function resolveConfigInputs(configPath: string): Promise<ConfigResolution> {
  const config = await loadConfig(configPath);
  const inputs = resolveSchemaInputs(config);
  if (!hasPslInputs(config)) {
    return {
      inputs,
      controlStack: emptyPipelineInputs,
      ...(config.formatter === undefined ? {} : { formatter: config.formatter }),
    };
  }
  const stack = createControlStack(config);
  const interpretation = resolveInterpretation(config, stack, inputs);
  return {
    inputs,
    controlStack: pipelineInputsFromStack(stack),
    ...(config.formatter === undefined ? {} : { formatter: config.formatter }),
    ...(interpretation === undefined ? {} : { interpretation }),
  };
}

export function resolveControlStackInputs(config: PrismaNextConfig): PipelineInputs | undefined {
  if (!hasPslInputs(config)) {
    return undefined;
  }
  return pipelineInputsFromStack(createControlStack(config));
}

function pipelineInputsFromStack(stack: ControlStack): PipelineInputs {
  return {
    scalarTypes: [...stack.scalarTypeDescriptors.keys()],
    pslBlockDescriptors: stack.authoringContributions.pslBlockDescriptors,
  };
}

function resolveInterpretation(
  config: PrismaNextConfig,
  stack: ControlStack,
  inputs: SchemaInputSet,
): ProjectInterpretation | undefined {
  const source = config.contract?.source;
  if (source === undefined || !hasPslInterpreter(source)) {
    return undefined;
  }
  return {
    source,
    context: {
      composedExtensionPacks: stack.extensionPacks.map((p) => p.id),
      composedExtensionContracts: stack.extensionContracts,
      scalarTypeDescriptors: stack.scalarTypeDescriptors,
      authoringContributions: stack.authoringContributions,
      codecLookup: stack.codecLookup,
      controlMutationDefaults: stack.controlMutationDefaults,
      resolvedInputs: [...inputs.uris()],
      capabilities: stack.capabilities,
    },
  };
}
