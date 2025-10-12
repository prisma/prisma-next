#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { parse } from './index';

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] !== 'emit') {
    console.error('Usage: psl emit <schema.psl>');
    process.exit(1);
  }

  if (args.length < 2) {
    console.error('Error: Please provide a schema file');
    process.exit(1);
  }

  const schemaFile = args[1];

  try {
    const input = readFileSync(schemaFile, 'utf-8');
    const ast = parse(input);

    // Output AST as JSON for now
    // In a real implementation, this would integrate with schema-emitter
    console.log(JSON.stringify(ast, null, 2));
  } catch (error) {
    console.error('Error processing schema:', error);
    process.exit(1);
  }
}

main();
