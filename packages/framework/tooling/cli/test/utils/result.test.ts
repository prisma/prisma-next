import { describe, expect, it } from 'vitest';
import { CliStructuredError, errorConfigFileNotFound } from '../../src/utils/cli-errors';
import { err, ok, performAction, wrapSync } from '../../src/utils/result';

describe('result utilities', () => {
  describe('ok', () => {
    it('creates successful result', () => {
      const result = ok('test');
      expect(result.ok).toBe(true);
      expect(result.value).toBe('test');
    });
  });

  describe('err', () => {
    it('creates error result', () => {
      const error = errorConfigFileNotFound();
      const result = err(error);
      expect(result.ok).toBe(false);
      expect(result.error).toBe(error);
    });
  });

  describe('performAction', () => {
    it('returns ok for successful async function', async () => {
      const result = await performAction(async () => {
        return 'success';
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('success');
      }
    });

    it('catches CliStructuredError and returns err', async () => {
      const error = errorConfigFileNotFound();
      const result = await performAction(async () => {
        throw error;
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(error);
      }
    });

    it('re-throws non-structured errors', async () => {
      const regularError = new Error('regular error');
      await expect(
        performAction(async () => {
          throw regularError;
        }),
      ).rejects.toThrow('regular error');
    });

    it('handles promise rejection with CliStructuredError', async () => {
      const error = errorConfigFileNotFound();
      const result = await performAction(async () => {
        return Promise.reject(error);
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(error);
      }
    });
  });

  describe('wrapSync', () => {
    it('returns ok for successful sync function', () => {
      const result = wrapSync(() => {
        return 'success';
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('success');
      }
    });

    it('catches CliStructuredError and returns err', () => {
      const error = errorConfigFileNotFound();
      const result = wrapSync(() => {
        throw error;
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(error);
      }
    });

    it('re-throws non-structured errors', () => {
      const regularError = new Error('regular error');
      expect(() => {
        wrapSync(() => {
          throw regularError;
        });
      }).toThrow('regular error');
    });
  });
});
