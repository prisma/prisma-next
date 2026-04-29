import type { EmptyRow, QueryContext, Scope } from '../scope';
import type { WithJoin, WithSelect } from './shared';

export interface JoinedTables<QC extends QueryContext, AvailableScope extends Scope, Registry = {}>
  extends WithSelect<QC, AvailableScope, EmptyRow, Registry>,
    WithJoin<QC, AvailableScope, QC['capabilities'], Registry> {}
