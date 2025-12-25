import {
  collectColumnRefs,
  extractBaseColumnRef,
  getColumnInfo,
  getOperationExpr,
  isColumnBuilder,
  isOperationExpr,
  isParamPlaceholder,
} from '@prisma-next/sql-relational-core/utils/guards';

// Re-export all utilities from relational-core
export {
  collectColumnRefs,
  extractBaseColumnRef,
  getColumnInfo,
  getOperationExpr,
  isColumnBuilder,
  isOperationExpr,
  isParamPlaceholder,
};
