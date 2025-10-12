import { describe, it, expect } from 'vitest';
import { parse } from '../src/index';

describe('PSL Parser', () => {
  it('should parse a simple model', () => {
    const psl = `
model User {
  id    Int    @id @default(autoincrement())
  email String @unique
}
`;

    const ast = parse(psl);

    expect(ast.type).toBe('Schema');
    expect(ast.models).toHaveLength(1);
    expect(ast.models[0].name).toBe('User');
    expect(ast.models[0].fields).toHaveLength(2);
    expect(ast.models[0].fields[0].name).toBe('id');
    expect(ast.models[0].fields[0].fieldType).toBe('Int');
    expect(ast.models[0].fields[1].name).toBe('email');
    expect(ast.models[0].fields[1].fieldType).toBe('String');
  });

  it('should parse attributes correctly', () => {
    const psl = `
model User {
  id Int @id @default(autoincrement())
}
`;

    const ast = parse(psl);
    const field = ast.models[0].fields[0];

    expect(field.attributes).toHaveLength(2);
    expect(field.attributes[0].name).toBe('id');
    expect(field.attributes[1].name).toBe('default');
    expect(field.attributes[1].args?.[0]?.value).toBe('autoincrement');
  });

  it('should handle multiple models', () => {
    const psl = `
model User {
  id Int @id
}

model Post {
  id Int @id
}
`;

    const ast = parse(psl);

    expect(ast.models).toHaveLength(2);
    expect(ast.models[0].name).toBe('User');
    expect(ast.models[1].name).toBe('Post');
  });
});
