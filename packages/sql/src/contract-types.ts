// Re-export contract types from sql-target to break circular dependency
// This file exists for backwards compatibility
export type {
  SqlContract,
  SqlStorage,
  SqlMappings,
  StorageColumn,
  StorageTable,
  ModelDefinition,
  ModelField,
  ModelStorage,
  PrimaryKey,
  UniqueConstraint,
  Index,
  ForeignKey,
  ForeignKeyReferences,
} from '@prisma-next/sql-target';
