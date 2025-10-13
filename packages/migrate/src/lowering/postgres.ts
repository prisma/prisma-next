import { ScriptAST, ColumnSpec, ConstraintSpec, IndexCol } from '../script-ast';

// Minimal OpSet types for MVP
export type OpSet = Op[];

export type Op =
  | AddTableOp
  | DropTableOp
  | AddColumnOp
  | AlterColumnOp
  | AddUniqueOp
  | AddForeignKeyOp
  | AddIndexOp;

export type AddTableOp = {
  kind: 'addTable';
  name: string;
  columns: ColumnSpec[];
  constraints?: ConstraintSpec[];
};

export type DropTableOp = {
  kind: 'dropTable';
  name: string;
};

export type AddColumnOp = {
  kind: 'addColumn';
  table: string;
  column: ColumnSpec;
};

export type AlterColumnOp = {
  kind: 'alterColumn';
  table: string;
  column: string;
  setNotNull?: true;
  dropNotNull?: true;
  setType?: ColumnSpec['type'];
  setDefault?: ColumnSpec['default'];
  dropDefault?: true;
};

export type AddUniqueOp = {
  kind: 'addUnique';
  table: string;
  columns: string[];
  name?: string;
};

export type AddForeignKeyOp = {
  kind: 'addForeignKey';
  table: string;
  columns: string[];
  ref: { table: string; columns: string[] };
  name?: string;
  onDelete?: 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';
  onUpdate?: 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';
};

export type AddIndexOp = {
  kind: 'addIndex';
  table: string;
  columns: IndexCol[];
  name?: string;
  unique?: boolean;
};

export interface DialectLowerer {
  target: 'postgres';
  lower(opset: OpSet): ScriptAST;
}

export function pgLowerer(): DialectLowerer {
  return {
    target: 'postgres',
    
    lower(opset: OpSet): ScriptAST {
      const statements: ScriptAST['statements'] = [];
      
      // Wrap all operations in a single transaction block
      const ddlStatements = opset.map(op => {
        switch (op.kind) {
          case 'addTable':
            return {
              type: 'createTable' as const,
              name: { name: op.name },
              columns: op.columns,
              constraints: op.constraints,
              ifNotExists: true
            };
          
          case 'dropTable':
            return {
              type: 'dropTable' as const,
              name: { name: op.name },
              ifExists: true
            };
          
          case 'addColumn':
            return {
              type: 'alterTable' as const,
              name: { name: op.table },
              alters: [{
                kind: 'addColumn' as const,
                column: op.column
              }]
            };
          
          case 'alterColumn':
            return {
              type: 'alterTable' as const,
              name: { name: op.table },
              alters: [{
                kind: 'alterColumn' as const,
                name: op.column,
                setNotNull: op.setNotNull,
                dropNotNull: op.dropNotNull,
                setType: op.setType,
                setDefault: op.setDefault,
                dropDefault: op.dropDefault
              }]
            };
          
          case 'addUnique':
            return {
              type: 'addConstraint' as const,
              table: { name: op.table },
              spec: {
                kind: 'unique' as const,
                columns: op.columns,
                name: op.name
              }
            };
          
          case 'addForeignKey':
            return {
              type: 'addConstraint' as const,
              table: { name: op.table },
              spec: {
                kind: 'foreignKey' as const,
                columns: op.columns,
                ref: op.ref,
                name: op.name,
                onDelete: op.onDelete,
                onUpdate: op.onUpdate
              }
            };
          
          case 'addIndex':
            return {
              type: 'createIndex' as const,
              name: { name: op.name || `${op.table}_${op.columns.map(c => c.name).join('_')}_idx` },
              table: { name: op.table },
              columns: op.columns,
              unique: op.unique
            };
          
          default:
            throw new Error(`Unsupported operation: ${(op as any).kind}`);
        }
      });
      
      // Wrap all DDL in a transaction block
      if (ddlStatements.length > 0) {
        statements.push({
          type: 'tx',
          statements: ddlStatements
        });
      }
      
      return {
        type: 'script',
        statements
      };
    }
  };
}
