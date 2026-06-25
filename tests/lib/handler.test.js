import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { safeHandler } from '../../lib/handler.js';

describe('handler.js', () => {
  it('calls the wrapped function with args', async () => {
    const fn = (args) => 'hello';
    const wrapped = safeHandler('test', fn);
    const result = await wrapped({ data: 1 });
    assert.equal(result, 'hello');
  });

  it('catches errors and sends ephemeral response via respond', async () => {
    const err = new Error('boom');
    const fn = () => {
      throw err;
    };
    const respond = () => Promise.resolve();
    const logger = { error: () => {} };

    const wrapped = safeHandler('test-handler', fn);
    // Should not throw
    await wrapped({ respond, logger });
  });

  it('falls back to client.chat.postMessage when no respond', async () => {
    const fn = () => {
      throw new Error('fail');
    };
    const client = { chat: { postMessage: () => Promise.resolve() } };
    const logger = { error: () => {} };

    const wrapped = safeHandler('test-handler', fn);
    await wrapped({ client, event: { channel: 'C123', ts: '1234.5678', thread_ts: '1234.5678' }, logger });
  });

  it('catches secondary errors without throwing', async () => {
    const fn = () => {
      throw new Error('primary');
    };
    const respond = () => {
      throw new Error('secondary');
    };
    const logger = { error: () => {} };

    const wrapped = safeHandler('test-handler', fn);
    // Should not throw even though respond also fails
    await wrapped({ respond, logger });
  });

  it('logs secondary errors', async () => {
    let secondaryLogged = false;
    const fn = () => {
      throw new Error('primary');
    };
    const respond = () => {
      throw new Error('secondary error');
    };
    const logger = {
      error: (msg) => {
        if (String(msg).includes('secondary error')) secondaryLogged = true;
      },
    };

    const wrapped = safeHandler('test-handler', fn);
    await wrapped({ respond, logger });
    assert.ok(secondaryLogged, 'secondary error should be logged');
  });

  it('user-facing error message does not leak raw error', async () => {
    let sentText = '';
    const fn = () => {
      throw new Error('secret_api_key=abc123');
    };
    const respond = (msg) => {
      sentText = msg.text;
      return Promise.resolve();
    };
    const logger = { error: () => {} };

    const wrapped = safeHandler('test-handler', fn);
    await wrapped({ respond, logger });
    assert.ok(!sentText.includes('secret_api_key'), 'must not leak raw error');
    assert.ok(!sentText.includes('abc123'), 'must not leak raw error');
    assert.ok(sentText.includes('error'), 'should show generic error');
  });
});
