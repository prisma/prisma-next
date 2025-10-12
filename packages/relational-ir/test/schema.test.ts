import { describe, it, expect } from 'vitest';
import { validateSchema, validateModel, validateField } from '../src/schema';

describe('Schema Validation', () => {
  it('should validate a complete schema', () => {
    const schema = {
      models: [
        {
          name: 'User',
          fields: [
            {
              name: 'id',
              type: 'Int',
              attributes: [{ name: 'id' }],
            },
            {
              name: 'email',
              type: 'String',
              attributes: [{ name: 'unique' }],
            },
          ],
        },
      ],
    };

    expect(() => validateSchema(schema)).not.toThrow();
  });

  it('should validate a model', () => {
    const model = {
      name: 'User',
      fields: [
        {
          name: 'id',
          type: 'Int',
          attributes: [],
        },
      ],
    };

    expect(() => validateModel(model)).not.toThrow();
  });

  it('should validate a field', () => {
    const field = {
      name: 'email',
      type: 'String',
      attributes: [{ name: 'unique' }],
    };

    expect(() => validateField(field)).not.toThrow();
  });
});
