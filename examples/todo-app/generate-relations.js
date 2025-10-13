import { readFileSync, writeFileSync } from 'fs';
import { emitRelationsTypes } from '@prisma/schema-emitter';
import { validateSchema } from '@prisma/relational-ir';

// Read the contract.json
const contractPath = '.prisma/contract.json';
const contract = JSON.parse(readFileSync(contractPath, 'utf-8'));

// Add foreign key manually for testing
contract.tables.post.foreignKeys = [
  {
    kind: 'foreignKey',
    columns: ['user_id'],
    references: {
      table: 'user',
      columns: ['id']
    },
    name: 'post_user_id_fkey'
  }
];

// Validate and generate relations
const schema = validateSchema(contract);
const relations = emitRelationsTypes(schema);

// Write relations.d.ts
writeFileSync('.prisma/relations.d.ts', relations);
console.log('✅ Generated relations.d.ts with foreign key');
