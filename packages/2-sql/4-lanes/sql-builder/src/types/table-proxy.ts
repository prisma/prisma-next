import type {
  ExtractCodecTypes,
  ExtractQueryOperationTypes,
} from '@prisma-next/sql-contract/types';
import type {
  DefaultScope,
  EmptyRow,
  JoinSource,
  QueryContext,
  RebindScope,
  Scope,
  StorageTableToScopeTable,
} from '../scope';
import type { TableProxyContract } from './db';
import type {
  DeleteQuery,
  InsertQuery,
  InsertValues,
  UpdateQuery,
  UpdateValues,
} from './mutation-query';
import type { WithJoin, WithSelect } from './shared';

type ContractToQC<C extends TableProxyContract> = {
  readonly codecTypes: ExtractCodecTypes<C>;
  readonly capabilities: C['capabilities'];
  readonly queryOperationTypes: ExtractQueryOperationTypes<C>;
};

export interface TableProxy<
  C extends TableProxyContract,
  Name extends string & keyof C['storage']['tables'],
  Alias extends string = Name,
  AvailableScope extends Scope = DefaultScope<Name, C['storage']['tables'][Name]>,
  QC extends QueryContext = ContractToQC<C>,
> extends JoinSource<StorageTableToScopeTable<C['storage']['tables'][Name]>, Alias>,
    WithSelect<QC, AvailableScope, EmptyRow>,
    WithJoin<QC, AvailableScope, C['capabilities']> {
  as<NewAlias extends string>(
    newAlias: NewAlias,
  ): TableProxy<C, Name, NewAlias, RebindScope<AvailableScope, Alias, NewAlias>>;

  insert(
    values: InsertValues<C['storage']['tables'][Name], QC['codecTypes']>,
  ): InsertQuery<QC, AvailableScope, EmptyRow>;

  update(
    set: UpdateValues<C['storage']['tables'][Name], QC['codecTypes']>,
  ): UpdateQuery<QC, AvailableScope, EmptyRow>;

  delete(): DeleteQuery<QC, AvailableScope, EmptyRow>;
}
