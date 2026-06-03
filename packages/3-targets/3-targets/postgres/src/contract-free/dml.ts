import { PostgresTableSource } from '../core/ast/table-source';

export function pgTableRef(options: {
  readonly name: string;
  readonly schema?: string;
  readonly alias?: string;
}): PostgresTableSource {
  return new PostgresTableSource(options);
}
