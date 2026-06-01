import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import {
  defaultStorageNamespaceIdForSqlTarget,
  POSTGRES_DEFAULT_STORAGE_NAMESPACE_ID,
} from '../src/default-namespace';

describe('defaultStorageNamespaceIdForSqlTarget', () => {
  it('uses public for postgres', () => {
    expect(defaultStorageNamespaceIdForSqlTarget('postgres')).toBe(
      POSTGRES_DEFAULT_STORAGE_NAMESPACE_ID,
    );
    expect(POSTGRES_DEFAULT_STORAGE_NAMESPACE_ID).toBe('public');
  });

  it('uses the unbound sentinel for non-postgres SQL targets', () => {
    expect(defaultStorageNamespaceIdForSqlTarget('sqlite')).toBe(UNBOUND_NAMESPACE_ID);
  });
});
