import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgresAdapterRuntime from '@prisma-next/adapter-postgres/runtime';
import pgvectorExtension from '@prisma-next/extension-pgvector/control';
import pgvectorExtensionRuntime from '@prisma-next/extension-pgvector/runtime';
import type {
  SqlControlAdapterDescriptor,
  SqlControlDescriptorWithContributions,
  SqlControlExtensionDescriptor,
  SqlControlTargetDescriptor,
} from '@prisma-next/family-sql/control';
import postgresTarget from '@prisma-next/target-postgres/control';
import postgresTargetRuntime from '@prisma-next/target-postgres/runtime';

const targetDescriptor = postgresTarget;
const adapterDescriptor = postgresAdapter;
const pgvectorDescriptor = pgvectorExtension;

export interface SqlDescriptorBundle {
  readonly target: SqlControlTargetDescriptor<'postgres', unknown>;
  readonly adapter: SqlControlAdapterDescriptor<'postgres'>;
  readonly extensions: ReadonlyArray<SqlControlExtensionDescriptor<'postgres'>>;
  readonly descriptors: ReadonlyArray<SqlControlDescriptorWithContributions>;
}

export function getSqlDescriptorBundle(options?: {
  readonly extensions?: ReadonlyArray<SqlControlExtensionDescriptor<'postgres'>>;
}): SqlDescriptorBundle {
  const extensions = options?.extensions ?? [];
  const descriptors: SqlControlDescriptorWithContributions[] = [
    targetDescriptor,
    adapterDescriptor,
    ...extensions,
  ];
  return {
    target: targetDescriptor,
    adapter: adapterDescriptor,
    extensions,
    descriptors,
  };
}

export const pgvectorExtensionDescriptor = pgvectorDescriptor;

export const postgresTargetRuntimeDescriptor = postgresTargetRuntime;
export const postgresAdapterRuntimeDescriptor = postgresAdapterRuntime;
export const pgvectorExtensionRuntimeDescriptor = pgvectorExtensionRuntime;
