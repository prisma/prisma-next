import {
  collectColumnRefs,
  expressionFromSource,
  extractBaseColumnRef,
  getColumnInfo,
  getColumnMeta,
  isColumnBuilder,
  isExpressionBuilder,
  isExpressionSource,
  isOperationExpr,
  isParamPlaceholder,
  isValueSource,
  toExpression,
} from '@prisma-next/sql-relational-core/utils/guards';

// Re-export all utilities from relational-core
export {
  collectColumnRefs,
  expressionFromSource,
  extractBaseColumnRef,
  getColumnInfo,
  getColumnMeta,
  isColumnBuilder,
  isExpressionBuilder,
  isExpressionSource,
  isOperationExpr,
  isParamPlaceholder,
  isValueSource,
  toExpression,
};
