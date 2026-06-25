import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { handleAltText, registerAltTextShortcut } from '../../listeners/altText.js';

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

describe('altText.js', () => {
  describe('registerAltTextShortcut', () => {
    it('registers generate_alt_text shortcut', () => {
      const { app, getCaptured } = makeFakeApp();
      registerAltTextShortcut(app);
      const cap = getCaptured();
      assert.equal(cap.name, 'generate_alt_text');
      assert.equal(typeof cap.handler, 'function');
    });

    it('acks immediately', async () => {
      const { app, getCaptured } = makeFakeApp();
      registerAltTextShortcut(app);
      let acked = false;
      await getCaptured().handler({
        shortcut: { message: { files: [] } },
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

    it('returns error card when message has no image', async () => {
      const { app, getCaptured } = makeFakeApp();
      registerAltTextShortcut(app);
      let sent;
      await getCaptured().handler({
        shortcut: { message: { files: [{ mimetype: 'application/pdf' }] } },
        ack: async () => {},
        respond: async (msg) => {
          sent = msg;
        },
        client: {},
        context: {},
        logger: { error: () => {} },
      });
      const json = JSON.stringify(sent);
      assert.ok(json.includes('No image') || json.includes("doesn't have an image"));
    });

    it('returns error card when message has no files at all', async () => {
      const { app, getCaptured } = makeFakeApp();
      registerAltTextShortcut(app);
      let sent;
      await getCaptured().handler({
        shortcut: { message: {} },
        ack: async () => {},
        respond: async (msg) => {
          sent = msg;
        },
        client: {},
        context: {},
        logger: { error: () => {} },
      });
      const json = JSON.stringify(sent);
      assert.ok(json.includes('No image') || json.includes("doesn't have an image"));
    });
  });

  describe('handleAltText', () => {
    it('returns error card when channel cannot be read', async () => {
      let sent;
      await handleAltText({
        command: { channel_id: 'C1' },
        respond: async (msg) => {
          sent = msg;
        },
        client: {
          conversations: {
            history: async () => {
              throw new Error('not_in_channel');
            },
          },
        },
        context: {},
        logger: { error: () => {} },
      });
      const json = JSON.stringify(sent);
      assert.ok(json.includes("Can't read") || json.includes('permission'));
      // Must not leak raw error
      assert.ok(!json.includes('not_in_channel'));
    });

    it('returns error card when no image is found in history', async () => {
      let sent;
      await handleAltText({
        command: { channel_id: 'C1' },
        respond: async (msg) => {
          sent = msg;
        },
        client: {
          conversations: { history: async () => ({ messages: [{ text: 'hello' }] }) },
        },
        context: {},
        logger: { error: () => {} },
      });
      const json = JSON.stringify(sent);
      assert.ok(json.includes('No image found'));
    });

    it('returns error card when history has only non-image files', async () => {
      let sent;
      await handleAltText({
        command: { channel_id: 'C1' },
        respond: async (msg) => {
          sent = msg;
        },
        client: {
          conversations: {
            history: async () => ({
              messages: [{ files: [{ mimetype: 'application/pdf', name: 'doc.pdf' }] }],
            }),
          },
        },
        context: {},
        logger: { error: () => {} },
      });
      const json = JSON.stringify(sent);
      assert.ok(json.includes('No image found'));
    });
  });
});
