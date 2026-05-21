/**
 * Operation type definitions for the SQL family.
 *
 * Public barrel that re-exports the type-only twin of the SQL family's
 * 15 operations. Imported by the family's control descriptor's
 * `types.queryOperationTypes` slot so the contract emitter aggregates
 * `SqlFamilyQueryOperationTypes` into the generated
 * `Contract['queryOperationTypes']`.
 */

export type {
  EqualityCodecId,
  OrderCodecId,
  QueryOperationTypes,
  TextualCodecId,
} from '../types/operation-types';
