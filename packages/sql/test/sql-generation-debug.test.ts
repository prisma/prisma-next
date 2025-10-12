import { describe, it, expect } from 'vitest';
import { sql } from '@prisma/sql';
import { makeT } from '@prisma/sql';

describe('SQL Generation Debug', () => {
  const mockSchema = {
    models: [
      {
        name: 'User',
        fields: [
          { name: 'id', type: 'Int', attributes: [] },
          { name: 'email', type: 'String', attributes: [] },
          { name: 'active', type: 'Boolean', attributes: [] }
        ]
      }
    ]
  };

  it('generates correct SQL for Column objects', () => {
    const t = makeT(mockSchema);
    
    console.log('t.user.id:', t.user.id);
    console.log('t.user.id.name:', t.user.id.name);
    console.log('t.user.id.table:', t.user.id.table);
    
    const query = sql()
      .from('user')
      .where(t.user.active.eq(true))
      .select({ id: t.user.id, email: t.user.email });

    const result = query.build();
    console.log('Generated SQL:', result.sql);
    console.log('Parameters:', result.params);
    
    // Check that the SQL contains the column names
    expect(result.sql).toContain('id AS id');
    expect(result.sql).toContain('email AS email');
  });
});
