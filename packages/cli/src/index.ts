import { Command } from 'commander';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { parse } from '@prisma/psl';
import { emitSchemaAndTypes } from '@prisma/schema-emitter';

const program = new Command();

program
  .name('prisma-next')
  .description('Prisma Next CLI - Type-safe query DSL for PostgreSQL')
  .version('0.0.0');

program
  .command('generate')
  .description('Generate schema.json and schema.d.ts from PSL file')
  .argument('<schema-file>', 'Path to the PSL schema file')
  .option('-o, --output-dir <dir>', 'Output directory for generated files', '.prisma')
  .action(async (schemaFile: string, options: { outputDir: string }) => {
    try {
      console.log(`📖 Reading schema file: ${schemaFile}`);
      const pslContent = readFileSync(schemaFile, 'utf-8');

      console.log('🔍 Parsing PSL schema...');
      const ast = parse(pslContent);

      console.log('⚡ Generating schema and types...');
      const { schema, types } = emitSchemaAndTypes(ast);

      // Ensure output directory exists
      mkdirSync(options.outputDir, { recursive: true });

      // Write schema.json
      const schemaPath = `${options.outputDir}/schema.json`;
      writeFileSync(schemaPath, schema);
      console.log(`✅ Generated ${schemaPath}`);

      // Write schema.d.ts
      const typesPath = `${options.outputDir}/schema.d.ts`;
      writeFileSync(typesPath, types);
      console.log(`✅ Generated ${typesPath}`);

      console.log('🎉 Schema generation complete!');
    } catch (error) {
      console.error('❌ Error generating schema:', error);
      process.exit(1);
    }
  });

program
  .command('dev')
  .description('Start development mode with file watching')
  .argument('<schema-file>', 'Path to the PSL schema file')
  .option('-o, --output-dir <dir>', 'Output directory for generated files', '.prisma')
  .action(async (schemaFile: string, options: { outputDir: string }) => {
    console.log('🚀 Starting development mode...');
    console.log(`📁 Watching: ${schemaFile}`);
    console.log(`📁 Output: ${options.outputDir}`);

    // For now, just run generate once
    // In a real implementation, this would watch for file changes
    try {
      const pslContent = readFileSync(schemaFile, 'utf-8');
      const ast = parse(pslContent);
      const { schema, types } = emitSchemaAndTypes(ast);

      mkdirSync(options.outputDir, { recursive: true });
      writeFileSync(`${options.outputDir}/schema.json`, schema);
      writeFileSync(`${options.outputDir}/schema.d.ts`, types);

      console.log('✅ Initial generation complete!');
      console.log('💡 Tip: Re-run this command when you modify your schema');
    } catch (error) {
      console.error('❌ Error in development mode:', error);
      process.exit(1);
    }
  });

program.parse();
