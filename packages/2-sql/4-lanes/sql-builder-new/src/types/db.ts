import type { StorageTable } from '@prisma-next/sql-contract/types';
import type { TableProxy } from './table-proxy';

export type CapabilitiesBase = Record<string, Record<string, boolean>>;

export type TableProxyContract = {
  readonly storage: { readonly tables: Record<string, StorageTable> };
  readonly capabilities: CapabilitiesBase;
};

export type Db<C extends TableProxyContract> = {
  [Name in string & keyof C['storage']['tables']]: TableProxy<C, Name>;
};
