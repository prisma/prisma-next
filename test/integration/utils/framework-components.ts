import postgresAdapter from '@prisma-next/adapter-postgres/control';
import type {
  ControlAdapterDescriptor,
  ControlExtensionDescriptor,
  ControlTargetDescriptor,
} from '@prisma-next/core-control-plane/types';
import pgvectorExtension from '@prisma-next/extension-pgvector/control';
import postgresTarget from '@prisma-next/target-postgres/control';

const targetDescriptor = postgresTarget satisfies ControlTargetDescriptor<'sql', 'postgres'>;
const adapterDescriptor = postgresAdapter satisfies ControlAdapterDescriptor<'sql', 'postgres'>;
const pgvectorDescriptor = pgvectorExtension satisfies ControlExtensionDescriptor<
  'sql',
  'postgres'
>;

type SqlDescriptor =
  | ControlTargetDescriptor<'sql', 'postgres'>
  | ControlAdapterDescriptor<'sql', 'postgres'>
  | ControlExtensionDescriptor<'sql', 'postgres'>;

export interface SqlDescriptorBundle {
  readonly target: ControlTargetDescriptor<'sql', 'postgres'>;
  readonly adapter: ControlAdapterDescriptor<'sql', 'postgres'>;
  readonly extensions: ReadonlyArray<ControlExtensionDescriptor<'sql', 'postgres'>>;
  readonly descriptors: ReadonlyArray<SqlDescriptor>;
}

export function getSqlDescriptorBundle(options?: {
  readonly extensions?: ReadonlyArray<ControlExtensionDescriptor<'sql', 'postgres'>>;
}): SqlDescriptorBundle {
  const extensions = options?.extensions ?? [];
  const descriptors: SqlDescriptor[] = [targetDescriptor, adapterDescriptor, ...extensions];
  return {
    target: targetDescriptor,
    adapter: adapterDescriptor,
    extensions,
    descriptors,
  };
}

export const pgvectorExtensionDescriptor = pgvectorDescriptor;
