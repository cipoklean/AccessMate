import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { handleSimplifySlash, registerSimplifyShortcut } from '../../listeners/simplify.js';

function makeFakeApp() {
  let captured;
  return {
    app: {
      shortcut: (name, handler) => {
        captured = { name, handler };
      },
    },
    getCaptured: () => captured,
  };
}

describe('simplify.js', () => {
  describe('registerSimplifyShortcut', () => {
    it('registers simplify_thread shortcut', () => {
      const { app, getCaptured } = makeFakeApp();
      registerSimplifyShortcut(app);
      const cap = getCaptured();
      assert.equal(cap.name, 'simplify_thread');
      assert.equal(typeof cap.handler, 'function');
    });

    it('acks immediately', async () => {
      const { app, getCaptured } = makeFakeApp();
      registerSimplifyShortcut(app);
      let acked = false;
      await getCaptured().handler({
        shortcut: { channel: { id: 'C1' }, user: { id: 'U1' }, message: { ts: '1.1' } },
        ack: async () => {
          acked = true;
        },
        client: {
          conversations: { replies: async () => ({ messages: [] }) },
          chat: { postEphemeral: async () => ({}) },
        },
        logger: { error: () => {}, info: () => {} },
      });
      assert.ok(acked);
    });
  });

  describe('handleSimplifySlash', () => {
    it('shows usage help when no link provided', async () => {
      let sent;
      await handleSimplifySlash({
        command: { text: '' },
        respond: async (msg) => {
          sent = msg;
        },
        client: {},
        logger: { error: () => {} },
      });
      assert.ok(sent.text.includes('/accessmate simplify'));
    });

    it('shows usage help when text has no http link', async () => {
      let sent;
      await handleSimplifySlash({
        command: { text: 'just some text' },
        respond: async (msg) => {
          sent = msg;
        },
        client: {},
        logger: { error: () => {} },
      });
      assert.ok(sent.text.includes('/accessmate simplify'));
    });

    it('rejects invalid link format', async () => {
      let sent;
      await handleSimplifySlash({
        command: { text: 'https://example.com/not-a-slack-link' },
        respond: async (msg) => {
          sent = msg;
        },
        client: {},
        logger: { error: () => {} },
      });
      assert.ok(sent.blocks, 'should return error card');
      const json = JSON.stringify(sent);
      assert.ok(json.includes('Invalid link') || json.includes("couldn't parse"));
    });

    it('reports no messages when thread is empty', async () => {
      let sent;
      await handleSimplifySlash({
        command: { text: 'https://acme.slack.com/archives/C12345/p170000000000000000' },
        respond: async (msg) => {
          sent = msg;
        },
        client: {
          conversations: { replies: async () => ({ messages: [] }) },
        },
        logger: { error: () => {} },
      });
      const json = JSON.stringify(sent);
      assert.ok(json.includes('No messages found') || json.includes('could not find'));
    });

    it('handles errors without leaking internals', async () => {
      let sent;
      await handleSimplifySlash({
        command: { text: 'https://acme.slack.com/archives/C12345/p170000000000000000' },
        respond: async (msg) => {
          sent = msg;
        },
        client: {
          conversations: {
            replies: async () => {
              throw new Error('secret_internal_path=/etc/passwd');
            },
          },
        },
        logger: { error: () => {} },
      });
      assert.ok(sent.blocks, 'should send error card');
      const json = JSON.stringify(sent);
      assert.ok(!json.includes('secret_internal_path'), 'must not leak internals');
    });
  });
});
