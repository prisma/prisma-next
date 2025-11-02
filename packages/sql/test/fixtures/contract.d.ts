// Contract type definitions following ADR 121 structure
// This provides storage-level Tables, application-level Models, Relations, and Mappings

export declare namespace Contract {
  // Symbol for metadata property to avoid collisions
  const META: unique symbol;

  type Meta<T extends { [META]: unknown }> = T[typeof META];

  // Metadata interfaces for extensibility
  interface TableMetadata<Name extends string> {
    name: Name;
  }

  interface ModelMetadata<Name extends string> {
    name: Name;
  }

  // Base interfaces with metadata
  interface TableDef<Name extends string> {
    readonly [META]: TableMetadata<Name>;
  }

  interface ModelDef<Name extends string> {
    readonly [META]: ModelMetadata<Name>;
  }

  // Storage-level types (raw database structure)
  export namespace Tables {
    export interface user extends TableDef<'user'> {
      id: number;
      email: string;
      createdAt: string; // timestamptz maps to string in MVP
    }
  }

  // Application-level types (with relations)
  // Note: This fixture has no relations, so Models match Tables structure
  export namespace Models {
    export interface User extends ModelDef<'User'> {
      id: number;
      email: string;
      createdAt: string;
    }
  }

  // Relation metadata for DSL and runtime
  // Empty for this fixture (no relations)
  export namespace Relations {
    // No relations in this fixture
  }

  // Model-table-field-column mappings
  export namespace Mappings {
    export interface ModelToTable {
      User: 'user';
    }

    export interface TableToModel {
      user: 'User';
    }

    export interface FieldToColumn {
      User: {
        id: 'id';
        email: 'email';
        createdAt: 'createdAt';
      };
    }

    export interface ColumnToField {
      user: {
        id: 'id';
        email: 'email';
        createdAt: 'createdAt';
      };
    }
  }
}

// Convenience type exports
export type Tables = Contract.Tables;
export type Models = Contract.Models;
export type Relations = Contract.Relations;
export type Mappings = Contract.Mappings;
