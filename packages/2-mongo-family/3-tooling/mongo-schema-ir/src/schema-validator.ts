import { MongoSchemaNode } from './schema-node';
import type { MongoSchemaVisitor } from './visitor';

export interface MongoSchemaValidatorOptions {
  readonly jsonSchema: Record<string, unknown>;
  readonly validationLevel: 'strict' | 'moderate';
  readonly validationAction: 'error' | 'warn';
}

export class MongoSchemaValidator extends MongoSchemaNode {
  readonly kind = 'validator' as const;
  readonly jsonSchema: Record<string, unknown>;
  readonly validationLevel: 'strict' | 'moderate';
  readonly validationAction: 'error' | 'warn';

  constructor(options: MongoSchemaValidatorOptions) {
    super();
    this.jsonSchema = options.jsonSchema;
    this.validationLevel = options.validationLevel;
    this.validationAction = options.validationAction;
    this.freeze();
  }

  accept<R>(visitor: MongoSchemaVisitor<R>): R {
    return visitor.validator(this);
  }
}
