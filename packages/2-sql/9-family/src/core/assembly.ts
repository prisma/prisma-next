import type { AuthoringContributions } from '@prisma-next/framework-components/authoring';
import type { Codec } from '@prisma-next/framework-components/codec';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import { assertUniqueCodecOwner } from '@prisma-next/framework-components/control';
import type { TypesImportSpec } from '@prisma-next/framework-components/emission';
import type {
  CodecControlHooks,
  ControlMutationDefaultFunctionEntry,
  ControlMutationDefaultGeneratorDescriptor,
  PslScalarTypeDescriptor,
  SqlControlStaticContributions,
} from './migrations/types';

export interface SqlControlDescriptorWithContributions extends SqlControlStaticContributions {
  readonly id: string;
  readonly authoring?: AuthoringContributions;
  readonly types?: {
    readonly codecTypes?: {
      readonly import?: TypesImportSpec;
      readonly codecInstances?: ReadonlyArray<Codec>;
      readonly typeImports?: ReadonlyArray<TypesImportSpec>;
    };
    readonly operationTypes?: { readonly import: TypesImportSpec };
  };
}

export interface AssembledControlMutationDefaultContributions {
  readonly defaultFunctionRegistry: ReadonlyMap<string, ControlMutationDefaultFunctionEntry>;
  readonly generatorDescriptors: readonly ControlMutationDefaultGeneratorDescriptor[];
}

export interface AssembledPslInterpretationContributions
  extends AssembledControlMutationDefaultContributions {
  readonly scalarTypeDescriptors: ReadonlyMap<string, PslScalarTypeDescriptor>;
}

type CodecControlHooksMap = Record<string, CodecControlHooks>;

function hasCodecControlHooks(descriptor: unknown): descriptor is {
  readonly id: string;
  readonly types: {
    readonly codecTypes: {
      readonly controlPlaneHooks: CodecControlHooksMap;
    };
  };
} {
  if (typeof descriptor !== 'object' || descriptor === null) {
    return false;
  }
  const d = descriptor as { types?: { codecTypes?: { controlPlaneHooks?: unknown } } };
  const hooks = d.types?.codecTypes?.controlPlaneHooks;
  return hooks !== null && hooks !== undefined && typeof hooks === 'object';
}

export function extractCodecControlHooks(
  descriptors: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>,
): Map<string, CodecControlHooks> {
  const hooks = new Map<string, CodecControlHooks>();
  const owners = new Map<string, string>();

  for (const descriptor of descriptors) {
    if (typeof descriptor !== 'object' || descriptor === null) {
      continue;
    }
    if (!hasCodecControlHooks(descriptor)) {
      continue;
    }
    const controlPlaneHooks = descriptor.types.codecTypes.controlPlaneHooks;
    for (const [codecId, hook] of Object.entries(controlPlaneHooks)) {
      assertUniqueCodecOwner({
        codecId,
        owners,
        descriptorId: descriptor.id,
        entityLabel: 'control hooks',
        entityOwnershipLabel: 'owner',
      });
      hooks.set(codecId, hook);
      owners.set(codecId, descriptor.id);
    }
  }

  return hooks;
}

export function assembleControlMutationDefaultContributions(
  descriptors: ReadonlyArray<SqlControlDescriptorWithContributions>,
): AssembledControlMutationDefaultContributions {
  const defaultFunctionRegistry = new Map<string, ControlMutationDefaultFunctionEntry>();
  const functionOwners = new Map<string, string>();
  const generatorMap = new Map<string, ControlMutationDefaultGeneratorDescriptor>();
  const generatorOwners = new Map<string, string>();

  for (const descriptor of descriptors) {
    const contributions = descriptor.controlMutationDefaults?.();
    if (!contributions) {
      continue;
    }

    for (const generatorDescriptor of contributions.generatorDescriptors) {
      const owner = generatorOwners.get(generatorDescriptor.id);
      if (owner) {
        throw new Error(
          `Duplicate mutation default generator id "${generatorDescriptor.id}". Descriptor "${descriptor.id}" conflicts with "${owner}".`,
        );
      }
      generatorMap.set(generatorDescriptor.id, generatorDescriptor);
      generatorOwners.set(generatorDescriptor.id, descriptor.id);
    }

    for (const [functionName, handler] of contributions.defaultFunctionRegistry) {
      const owner = functionOwners.get(functionName);
      if (owner) {
        throw new Error(
          `Duplicate mutation default function "${functionName}". Descriptor "${descriptor.id}" conflicts with "${owner}".`,
        );
      }
      defaultFunctionRegistry.set(functionName, handler);
      functionOwners.set(functionName, descriptor.id);
    }
  }

  return {
    defaultFunctionRegistry,
    generatorDescriptors: Array.from(generatorMap.values()),
  };
}

export function assemblePslInterpretationContributions(
  descriptors: ReadonlyArray<SqlControlDescriptorWithContributions>,
): AssembledPslInterpretationContributions {
  const mutationDefaults = assembleControlMutationDefaultContributions(descriptors);
  const scalarTypeDescriptors = new Map<string, PslScalarTypeDescriptor>();
  const scalarOwners = new Map<string, string>();

  for (const descriptor of descriptors) {
    const pslTypeContributions = descriptor.pslTypeDescriptors?.();
    if (!pslTypeContributions) {
      continue;
    }

    for (const [typeName, scalarDescriptor] of pslTypeContributions.scalarTypeDescriptors) {
      const owner = scalarOwners.get(typeName);
      if (owner) {
        throw new Error(
          `Duplicate PSL scalar type descriptor "${typeName}". Descriptor "${descriptor.id}" conflicts with "${owner}".`,
        );
      }
      scalarTypeDescriptors.set(typeName, scalarDescriptor);
      scalarOwners.set(typeName, descriptor.id);
    }
  }

  return {
    ...mutationDefaults,
    scalarTypeDescriptors,
  };
}
