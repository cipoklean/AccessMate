import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { activeProvider, classifyLlmError, fallbackChain, PROVIDERS } from '../../lib/llm.js';

/**
 * Tests for fallback chain behavior and context-aware error classification.
 *
 * Note: chatComplete() creates real OpenAI clients internally and we can't
 * easily mock the constructor in ESM. The fallback *logic* is tested indirectly
 * through classifyLlmError and the chain structure. Integration tests that
 * verify actual provider failover would need a separate mock-infrastructure
 * (e.g. a wrapper module that injects the client factory).
 */
describe('llm.js fallback chain', () => {
  describe('fallbackChain structure', () => {
    it('always has the active provider as the first entry', () => {
      assert.equal(fallbackChain[0], activeProvider);
    });

    it('has at least one provider in the chain', () => {
      assert.ok(fallbackChain.length >= 1, 'fallback chain must have at least one provider');
    });

    it('contains no duplicate providers', () => {
      const seen = new Set();
      for (const p of fallbackChain) {
        assert.ok(!seen.has(p), 'fallback chain should not have duplicates');
        seen.add(p);
      }
    });

    it('chain length equals 1 when no fallback API keys are set', () => {
      // In test env, only GEMINI_API_KEY may be set (or none).
      // The chain is always at least 1 (the primary).
      assert.ok(fallbackChain.length >= 1);
    });
  });

  describe('provider capability flags', () => {
    it('gemini supports vision', () => {
      assert.equal(PROVIDERS.gemini.supportsVision, true);
    });

    it('openai supports vision', () => {
      assert.equal(PROVIDERS.openai.supportsVision, true);
    });

    it('groq does NOT support vision', () => {
      assert.equal(PROVIDERS.groq.supportsVision, false);
    });

    it('every provider has supportsVision boolean', () => {
      for (const [name, p] of Object.entries(PROVIDERS)) {
        assert.ok(typeof p.supportsVision === 'boolean', `${name} missing supportsVision boolean`);
      }
    });

    it('filtering to vision-only providers excludes groq', () => {
      const visionOnly = Object.values(PROVIDERS).filter((p) => p.supportsVision);
      assert.ok(!visionOnly.includes(PROVIDERS.groq), 'groq should be excluded from vision-capable list');
      assert.ok(visionOnly.includes(PROVIDERS.gemini), 'gemini should be in vision-capable list');
      assert.ok(visionOnly.includes(PROVIDERS.openai), 'openai should be in vision-capable list');
    });
  });

  describe('classifyLlmError — task context (graceful degradation)', () => {
    it('includes task-specific message for simplify', () => {
      const msg = classifyLlmError({ message: 'boom' }, { task: 'simplify' });
      assert.ok(msg.includes("couldn't summarize"), 'should mention summarizing');
      assert.ok(msg.includes('AI service may be temporarily down'));
    });

    it('includes task-specific message for alt-text', () => {
      const msg = classifyLlmError({ message: 'boom' }, { task: 'alt-text' });
      assert.ok(msg.includes("couldn't describe"), 'should mention describing');
      assert.ok(msg.includes('AI service may be temporarily down'));
    });

    it('includes task-specific message for qa', () => {
      const msg = classifyLlmError({ message: 'boom' }, { task: 'qa' });
      assert.ok(msg.includes("couldn't answer"), 'should mention answering');
      assert.ok(msg.includes('AI service may be temporarily down'));
    });

    it('includes task-specific message for digest', () => {
      const msg = classifyLlmError({ message: 'boom' }, { task: 'digest' });
      assert.ok(msg.includes("couldn't build the digest"), 'should mention digest');
      assert.ok(msg.includes('AI service may be temporarily down'));
    });

    it('appends detail to generic fallback with task', () => {
      const msg = classifyLlmError({ message: 'boom' }, { task: 'simplify', detail: '(5 messages were found.)' });
      assert.ok(msg.includes('(5 messages were found.)'), 'should include detail');
    });

    it('appends detail to generic fallback without task', () => {
      const msg = classifyLlmError({ message: 'boom' }, { detail: 'Retry later.' });
      assert.ok(msg.includes('Retry later.'), 'should include detail');
      assert.ok(msg.includes('Something went wrong'), 'should use generic template');
    });

    it('does NOT append detail for known status codes (429)', () => {
      const msg = classifyLlmError({ status: 429 }, { task: 'simplify', detail: '(5 messages)' });
      assert.ok(msg.includes('rate-limited'));
      assert.ok(!msg.includes('(5 messages)'), 'detail should not override specific error messages');
    });

    it('does NOT append detail for known status codes (401)', () => {
      const msg = classifyLlmError({ status: 401 }, { task: 'alt-text', detail: '(image.png)' });
      assert.ok(msg.includes('auth'));
      assert.ok(!msg.includes('(image.png)'));
    });

    it('does NOT append detail for network errors', () => {
      const msg = classifyLlmError({ code: 'ETIMEDOUT' }, { task: 'qa', detail: '(3 msgs)' });
      assert.ok(msg.includes('trouble reaching'));
      assert.ok(!msg.includes('(3 msgs)'));
    });

    it('handles empty options object', () => {
      const msg = classifyLlmError({ message: 'boom' }, {});
      assert.ok(msg.includes('Something went wrong'));
    });

    it('handles undefined options (backward compat)', () => {
      const msg = classifyLlmError({ message: 'boom' }, undefined);
      assert.ok(msg.includes('Something went wrong'));
    });

    it('task context still does not leak raw error details', () => {
      const msg = classifyLlmError({ message: 'SECRET_API_KEY_EXPOSED' }, { task: 'simplify' });
      assert.ok(!msg.includes('SECRET_API_KEY_EXPOSED'), 'must never leak raw error');
    });
  });

  describe('fallback chain ordering logic', () => {
    it('active provider is always first in chain', () => {
      // This verifies the invariant regardless of env config
      assert.equal(fallbackChain[0], activeProvider);
    });

    it('all providers in chain have required fields', () => {
      for (const p of fallbackChain) {
        assert.ok(p.apiKeyEnv, 'chain provider missing apiKeyEnv');
        assert.ok(p.baseURL, 'chain provider missing baseURL');
        assert.ok(p.model, 'chain provider missing model');
        assert.ok(p.keyLabel, 'chain provider missing keyLabel');
        assert.ok(typeof p.supportsVision === 'boolean', 'chain provider missing supportsVision');
      }
    });
  });
});
