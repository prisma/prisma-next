import { type } from 'arktype';
import type { NamespaceId } from './namespace-id';

export interface CrossReference {
  readonly namespace: NamespaceId;
  readonly model: string;
}

export const CrossReferenceSchema = type({
  '+': 'reject',
  namespace: 'string',
  model: 'string',
});
