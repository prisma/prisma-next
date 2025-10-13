import { QueryAST, SelectClause, WhereClause, OrderByClause, LimitClause } from '@prisma/sql';

export interface RelationHandle {
  parent: string; // 'user'
  child: string; // 'post'
  cardinality: '1:N' | 'N:1';
  on: {
    parentCols: string[]; // ['id']
    childCols: string[]; // ['user_id']
  };
  name: string; // 'posts' or 'user'
}

export interface IncludeNode {
  kind: 'Include';
  relation: RelationHandle;
  alias: string;
  mode: 'nested' | 'flat';
  child: OrmQueryAST;
}

export interface OrmQueryAST {
  type: 'select';
  from: string;
  contractHash?: string;
  projectStar?: boolean;
  select?: SelectClause;
  where?: WhereClause;
  orderBy?: OrderByClause[];
  limit?: LimitClause;
  includes?: IncludeNode[];
}
