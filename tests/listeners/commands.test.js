import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { registerAccessMateCommand } from '../../listeners/commands.js';

function makeFakeApp() {
  let captured;
  return {
    app: {
      command: (name, handler) => {
        captured = { name, handler };
      },
    },
    getCaptured: () => captured,
  };
}

describe('commands.js', () => {
  it('registers /accessmate command', () => {
    const { app, getCaptured } = makeFakeApp();
    registerAccessMateCommand(app);
    const cap = getCaptured();
    assert.equal(cap.name, '/accessmate');
    assert.equal(typeof cap.handler, 'function');
  });

  it('always acks first', async () => {
    const { app, getCaptured } = makeFakeApp();
    registerAccessMateCommand(app);
    const handler = getCaptured().handler;

    let acked = false;
    await handler({
      command: { text: 'ping' },
      ack: async () => {
        acked = true;
      },
      respond: async () => {},
      client: {},
      context: {},
      logger: { error: () => {} },
    });
    assert.ok(acked);
  });

  it('ping returns pong', async () => {
    const { app, getCaptured } = makeFakeApp();
    registerAccessMateCommand(app);
    const handler = getCaptured().handler;

    let sentResponse;
    await handler({
      command: { text: 'ping' },
      ack: async () => {},
      respond: async (msg) => {
        sentResponse = msg;
      },
      client: {},
      context: {},
      logger: { error: () => {} },
    });
    assert.ok(sentResponse.text.includes('pong'));
    assert.equal(sentResponse.response_type, 'ephemeral');
  });

  it('ping is case-insensitive', async () => {
    const { app, getCaptured } = makeFakeApp();
    registerAccessMateCommand(app);
    const handler = getCaptured().handler;

    let sentResponse;
    await handler({
      command: { text: 'PING' },
      ack: async () => {},
      respond: async (msg) => {
        sentResponse = msg;
      },
      client: {},
      context: {},
      logger: { error: () => {} },
    });
    assert.ok(sentResponse.text.includes('pong'));
  });

  it('default subcommand shows help with command list', async () => {
    const { app, getCaptured } = makeFakeApp();
    registerAccessMateCommand(app);
    const handler = getCaptured().handler;

    let sentResponse;
    await handler({
      command: { text: '' },
      ack: async () => {},
      respond: async (msg) => {
        sentResponse = msg;
      },
      client: {},
      context: {},
      logger: { error: () => {} },
    });
    assert.ok(sentResponse.blocks, 'help should have blocks');
    const helpText = JSON.stringify(sentResponse);
    assert.ok(helpText.includes('/accessmate alt'));
    assert.ok(helpText.includes('/accessmate simplify'));
    assert.ok(helpText.includes('/accessmate digest'));
    assert.ok(helpText.includes('/accessmate ping'));
  });

  it('handles errors gracefully without leaking internals', async () => {
    const { app, getCaptured } = makeFakeApp();
    registerAccessMateCommand(app);
    const handler = getCaptured().handler;

    let sentResponse;
    // Make respond throw on first call to trigger outer catch path via ack
    // Instead, throw inside a subcommand path by making respond itself fail
    await handler({
      command: { text: 'ping' },
      ack: async () => {},
      respond: async (msg) => {
        if (msg.text?.includes('pong')) throw new Error('internal_secret_xyz');
        sentResponse = msg;
      },
      client: {},
      context: {},
      logger: { error: () => {} },
    });
    // Should have sent a fallback error message that does NOT contain the secret
    assert.ok(sentResponse, 'should send a fallback error');
    assert.ok(!sentResponse.text.includes('internal_secret_xyz'), 'must not leak internal error');
  });
});
