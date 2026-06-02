import type { StorageHashBase } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { expectTypeOf, test } from 'vitest';
import { buildSqlNamespace } from '../src/ir/build-sql-namespace';
import { type SqlNamespace, SqlStorage } from '../src/ir/sql-storage';

const publicNs = buildSqlNamespace({ id: 'public', tables: {} });
const unboundNs = buildSqlNamespace({ id: UNBOUND_NAMESPACE_ID, tables: {} });

test('SqlStorage accepts namespaces with only a public key (no __unbound__)', () => {
  const storage = new SqlStorage({
    storageHash: 'sha256:test' as StorageHashBase<string>,
    namespaces: { public: publicNs },
  });
  expectTypeOf(storage.namespaces).toExtend<Readonly<Record<string, SqlNamespace>>>();
});

test('SqlStorage still accepts namespaces with only an __unbound__ key', () => {
  const storage = new SqlStorage({
    storageHash: 'sha256:test' as StorageHashBase<string>,
    namespaces: { [UNBOUND_NAMESPACE_ID]: unboundNs },
  });
  expectTypeOf(storage.namespaces).toExtend<Readonly<Record<string, SqlNamespace>>>();
});
