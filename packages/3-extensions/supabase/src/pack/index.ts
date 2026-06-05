import type { ControlExtensionDescriptor } from '@prisma-next/framework-components/control';

// TODO(D3): replace this stub with the real ExtensionPack value carrying the
// emitted contract.json + spaceId: 'supabase'. This placeholder exists so
// the ./pack subpath typechecks and the package builds before the contract is
// authored (Dispatch 2) and the real pack is assembled (Dispatch 3).

const SUPABASE_EXTENSION_ID = 'supabase' as const;

const supabasePack: ControlExtensionDescriptor<'sql', 'postgres'> = {
  kind: 'extension' as const,
  id: SUPABASE_EXTENSION_ID,
  version: '0.12.0',
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  create() {
    return {
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
    };
  },
};

export function supabasePackWith(_options?: {
  contractOverride?: unknown;
}): ControlExtensionDescriptor<'sql', 'postgres'> {
  return supabasePack;
}

export default supabasePack;
