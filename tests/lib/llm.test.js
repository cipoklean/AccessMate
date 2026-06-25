import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { activeProvider, classifyLlmError, DEFAULT_MODEL, normalizeBullets, PROVIDERS } from '../../lib/llm.js';

describe('llm.js', () => {
  describe('provider abstraction', () => {
    it('exposes a gemini provider', () => {
      assert.ok(PROVIDERS.gemini);
      assert.equal(PROVIDERS.gemini.apiKeyEnv, 'GEMINI_API_KEY');
      assert.ok(PROVIDERS.gemini.baseURL.includes('googleapis.com'));
    });

    it('exposes an openai provider', () => {
      assert.ok(PROVIDERS.openai);
      assert.equal(PROVIDERS.openai.apiKeyEnv, 'OPENAI_API_KEY');
      assert.ok(PROVIDERS.openai.baseURL.includes('openai.com'));
    });

    it('defaults to gemini when LLM_PROVIDER is unset', () => {
      // activeProvider is resolved at import time. The test process does not set
      // LLM_PROVIDER, so it should resolve to the gemini provider.
      assert.equal(activeProvider, PROVIDERS.gemini);
    });

    it('DEFAULT_MODEL falls back to the active provider default', () => {
      assert.equal(DEFAULT_MODEL, activeProvider.model);
    });

    it('every provider has all required fields', () => {
      for (const [name, p] of Object.entries(PROVIDERS)) {
        assert.ok(p.apiKeyEnv, `${name} missing apiKeyEnv`);
        assert.ok(p.baseURL, `${name} missing baseURL`);
        assert.ok(p.model, `${name} missing model`);
        assert.ok(p.keyLabel, `${name} missing keyLabel`);
      }
    });
  });

  describe('classifyLlmError', () => {
    it('returns rate-limit message for 429', () => {
      const msg = classifyLlmError({ status: 429 });
      assert.ok(msg.includes('rate-limited'));
    });

    it('returns auth message for 401', () => {
      const msg = classifyLlmError({ status: 401 });
      assert.ok(msg.includes('auth'));
    });

    it('returns auth message for 403', () => {
      const msg = classifyLlmError({ status: 403 });
      assert.ok(msg.includes('auth'));
    });

    it('returns service error message for 500', () => {
      const msg = classifyLlmError({ status: 500 });
      assert.ok(msg.includes('having a moment'));
    });

    it('returns service error message for 502', () => {
      const msg = classifyLlmError({ status: 502 });
      assert.ok(msg.includes('having a moment'));
    });

    it('handles nested response.status', () => {
      const msg = classifyLlmError({ response: { status: 429 } });
      assert.ok(msg.includes('rate-limited'));
    });

    it('handles ETIMEDOUT code', () => {
      const msg = classifyLlmError({ code: 'ETIMEDOUT' });
      assert.ok(msg.includes('trouble reaching'));
    });

    it('handles ECONNRESET code', () => {
      const msg = classifyLlmError({ code: 'ECONNRESET' });
      assert.ok(msg.includes('trouble reaching'));
    });

    it('handles ENOTFOUND code', () => {
      const msg = classifyLlmError({ code: 'ENOTFOUND' });
      assert.ok(msg.includes('trouble reaching'));
    });

    it('returns generic message for unknown errors', () => {
      const msg = classifyLlmError({ message: 'random error' });
      assert.ok(msg.includes('Something went wrong'));
      // Must NOT include raw error message
      assert.ok(!msg.includes('random error'), 'should not leak raw error');
    });

    it('handles null/undefined error', () => {
      const msg = classifyLlmError(null);
      assert.ok(msg.includes('Something went wrong'));
    });

    it('handles error with no status or code', () => {
      const msg = classifyLlmError({});
      assert.ok(msg.includes('Something went wrong'));
    });

    it('prioritizes status over code', () => {
      const msg = classifyLlmError({ status: 429, code: 'ETIMEDOUT' });
      assert.ok(msg.includes('rate-limited'));
    });
  });

  describe('normalizeBullets', () => {
    it('normalizes dash-prefixed bullets', () => {
      assert.equal(normalizeBullets('- First item\n- Second item'), '- First item\n- Second item');
    });

    it('normalizes asterisk-prefixed bullets', () => {
      assert.equal(normalizeBullets('* First item\n* Second item'), '- First item\n- Second item');
    });

    it('normalizes bullet-char-prefixed bullets', () => {
      assert.equal(normalizeBullets('• First item\n• Second item'), '- First item\n- Second item');
    });

    it('handles mixed bullet styles', () => {
      const result = normalizeBullets('- One\n* Two\n• Three');
      assert.ok(result.includes('- One'));
      assert.ok(result.includes('- Two'));
      assert.ok(result.includes('- Three'));
    });

    it('wraps markerless text as a single bullet', () => {
      // normalizeBullets treats any non-empty text as bullet content
      assert.equal(normalizeBullets('Just plain text here'), '- Just plain text here');
    });

    it('handles empty string', () => {
      assert.equal(normalizeBullets(''), '');
    });

    it('handles null/undefined', () => {
      assert.equal(normalizeBullets(null), null);
      assert.equal(normalizeBullets(undefined), undefined);
    });

    it('strips leading whitespace before bullet markers', () => {
      const result = normalizeBullets('  * Spaced item');
      assert.ok(result.includes('- Spaced item'));
    });
  });
});
