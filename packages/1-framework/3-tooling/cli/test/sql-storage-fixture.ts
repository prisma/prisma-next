import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';

export function sqlTestStorageWithTables(tables: Record<string, unknown>) {
  return {
    [UNBOUND_NAMESPACE_ID]: {
      id: UNBOUND_NAMESPACE_ID,
      tables,
    },
  };
}
