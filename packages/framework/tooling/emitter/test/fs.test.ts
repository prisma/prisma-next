import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readJsonFile, readTextFile } from '../src/fs';

describe('fs', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `prisma-next-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('readJsonFile', () => {
    it('reads valid JSON file', async () => {
      const content = { id: 'test', version: '1.0.0' };
      const filePath = join(tempDir, 'manifest.json');
      await writeFile(filePath, JSON.stringify(content, null, 2));

      const result = readJsonFile(filePath);
      expect(result).toEqual(content);
    });

    it('throws error when file does not exist', () => {
      const filePath = join(tempDir, 'nonexistent.json');
      expect(() => {
        readJsonFile(filePath);
      }).toThrow(`Failed to read file at ${filePath}`);
    });

    it('throws error when JSON is invalid', async () => {
      const filePath = join(tempDir, 'invalid.json');
      await writeFile(filePath, '{ invalid json }');

      expect(() => {
        readJsonFile(filePath);
      }).toThrow(`Failed to parse JSON at ${filePath}`);
    });
  });

  describe('readTextFile', () => {
    it('reads text file', async () => {
      const content = 'test content';
      const filePath = join(tempDir, 'test.txt');
      await writeFile(filePath, content);

      const result = readTextFile(filePath);
      expect(result).toBe(content);
    });

    it('throws error when file does not exist', () => {
      const filePath = join(tempDir, 'nonexistent.txt');
      expect(() => {
        readTextFile(filePath);
      }).toThrow(`Failed to read file at ${filePath}`);
    });
  });
});
