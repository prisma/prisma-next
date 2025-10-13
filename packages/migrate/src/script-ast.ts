import { ColumnType, DefaultValue } from '@prisma/relational-ir';

// FKAction type definition
export type FKAction = 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';

// Identifier type for quoted names
export type Ident = { name: string };

// Column specification for DDL operations
export type ColumnSpec = {
  name: string;
  type: ColumnType;
  nullable: boolean;
  default?: DefaultValue;
};

// Constraint specification
export type ConstraintSpec =
  | { kind: 'primaryKey'; columns: string[]; name?: string }
  | { kind: 'unique'; columns: string[]; name?: string }
  | {
      kind: 'foreignKey';
      columns: string[];
      ref: { table: string; columns: string[] };
      name?: string;
      onDelete?: FKAction;
      onUpdate?: FKAction;
    };

// Table alteration specification
export type TableAlterSpec =
  | { kind: 'addColumn'; column: ColumnSpec }
  | { kind: 'dropColumn'; name: string }
  | {
      kind: 'alterColumn';
      name: string;
      setNotNull?: true;
      dropNotNull?: true;
      setType?: ColumnType;
      setDefault?: DefaultValue;
      dropDefault?: true;
    };

// Index column specification
export type IndexCol = {
  name: string;
  opclass?: string;
  order?: 'asc' | 'desc' | undefined;
};

// Raw statement AST for unsafe SQL
export type RawStmtAST = {
  type: 'raw';
  template: Array<{ kind: 'text'; value: string } | { kind: 'rawUnsafe'; sql: string }>;
  intent?: 'ddl' | 'read' | 'write';
};

// Transaction block AST
export type TxBlockAST = {
  type: 'tx';
  statements: DdlAST[];
};

// DDL operation ASTs
export type CreateTableAST = {
  type: 'createTable';
  name: Ident;
  columns: ColumnSpec[];
  constraints?: ConstraintSpec[];
  ifNotExists?: boolean;
};

export type DropTableAST = {
  type: 'dropTable';
  name: Ident;
  ifExists?: boolean;
};

export type AlterTableAST = {
  type: 'alterTable';
  name: Ident;
  alters: TableAlterSpec[];
};

export type CreateIndexAST = {
  type: 'createIndex';
  name: Ident;
  table: Ident;
  columns: IndexCol[];
  unique?: boolean;
  concurrently?: boolean;
};

export type DropIndexAST = {
  type: 'dropIndex';
  name: Ident;
  ifExists?: boolean;
  concurrently?: boolean;
};

export type AddConstraintAST = {
  type: 'addConstraint';
  table: Ident;
  spec: ConstraintSpec;
};

export type DropConstraintAST = {
  type: 'dropConstraint';
  table: Ident;
  name: Ident;
};

// Union of all DDL operations
export type DdlAST =
  | CreateTableAST
  | DropTableAST
  | AlterTableAST
  | CreateIndexAST
  | DropIndexAST
  | AddConstraintAST
  | DropConstraintAST;

// Statement AST union
export type StatementAST = TxBlockAST | DdlAST | RawStmtAST;

// Root script AST
export type ScriptAST = {
  type: 'script';
  statements: StatementAST[];
};
