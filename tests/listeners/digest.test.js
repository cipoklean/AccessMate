import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runDigestNow } from '../../listeners/digest.js';

describe('digest.js', () => {
  describe('runDigestNow', () => {
    it('returns error when no target user provided', async () => {
      const result = await runDigestNow({}, { error: () => {} });
      assert.ok(result.error);
      assert.ok(result.error.includes('user'));
    });

    it('detects alt-text gaps and posts digest to DM', async () => {
      let postedMessage = null;
      let openedFor = null;
      const client = {
        conversations: {
          list: async () => ({
            channels: [{ id: 'C1', name: 'general', is_member: true }],
          }),
          history: async () => ({
            messages: [
              {
                ts: '1700000000.000000',
                user: 'U1',
                files: [{ mimetype: 'image/png', name: 'pic.png', alt_txt: '' }],
              },
              {
                ts: '1700000001.000000',
                user: 'U2',
                files: [{ mimetype: 'image/jpeg', name: 'good.jpg', alt_txt: 'A nice photo' }],
              },
            ],
          }),
          open: async ({ users }) => {
            openedFor = users;
            return { channel: { id: 'DM1' } };
          },
        },
        chat: {
          postMessage: async (msg) => {
            postedMessage = msg;
            return { ok: true };
          },
        },
      };

      const result = await runDigestNow(client, { info: () => {}, warn: () => {} }, 'U_TARGET');
      assert.equal(result.sent, true);
      assert.equal(result.count, 1, 'should find exactly 1 gap');
      assert.equal(openedFor, 'U_TARGET');
      assert.equal(postedMessage.channel, 'DM1');
    });

    it('posts no-gaps message when every image has alt text', async () => {
      let postedMessage = null;
      const client = {
        conversations: {
          list: async () => ({
            channels: [{ id: 'C1', name: 'general', is_member: true }],
          }),
          history: async () => ({
            messages: [
              {
                ts: '1700000000.000000',
                user: 'U1',
                files: [{ mimetype: 'image/png', name: 'pic.png', alt_txt: 'A cat' }],
              },
            ],
          }),
          open: async () => ({ channel: { id: 'DM1' } }),
        },
        chat: {
          postMessage: async (msg) => {
            postedMessage = msg;
            return { ok: true };
          },
        },
      };

      const result = await runDigestNow(client, { info: () => {}, warn: () => {} }, 'U_TARGET');
      assert.equal(result.count, 0);
      assert.ok(postedMessage.text.includes('No accessibility gaps'));
    });

    it('skips bot messages', async () => {
      const client = {
        conversations: {
          list: async () => ({
            channels: [{ id: 'C1', name: 'general', is_member: true }],
          }),
          history: async () => ({
            messages: [
              {
                ts: '1700000000.000000',
                user: 'U1',
                subtype: 'bot_message',
                files: [{ mimetype: 'image/png', name: 'bot-pic.png', alt_txt: '' }],
              },
            ],
          }),
          open: async () => ({ channel: { id: 'DM1' } }),
        },
        chat: { postMessage: async () => ({ ok: true }) },
      };

      const result = await runDigestNow(client, { info: () => {}, warn: () => {} }, 'U_TARGET');
      assert.equal(result.count, 0, 'bot_message files should not count as gaps');
    });

    it('skips non-image files', async () => {
      const client = {
        conversations: {
          list: async () => ({
            channels: [{ id: 'C1', name: 'general', is_member: true }],
          }),
          history: async () => ({
            messages: [
              {
                ts: '1700000000.000000',
                user: 'U1',
                files: [{ mimetype: 'application/pdf', name: 'doc.pdf', alt_txt: '' }],
              },
            ],
          }),
          open: async () => ({ channel: { id: 'DM1' } }),
        },
        chat: { postMessage: async () => ({ ok: true }) },
      };

      const result = await runDigestNow(client, { info: () => {}, warn: () => {} }, 'U_TARGET');
      assert.equal(result.count, 0, 'non-image files should not count');
    });

    it('skips channels the bot is not a member of', async () => {
      const listCalls = [];
      const client = {
        conversations: {
          list: async () => ({
            channels: [
              { id: 'C1', name: 'joined', is_member: true },
              { id: 'C2', name: 'not-joined', is_member: false },
            ],
          }),
          history: async ({ channel }) => {
            listCalls.push(channel);
            return { messages: [] };
          },
          open: async () => ({ channel: { id: 'DM1' } }),
        },
        chat: { postMessage: async () => ({ ok: true }) },
      };

      await runDigestNow(client, { info: () => {}, warn: () => {} }, 'U_TARGET');
      assert.deepEqual(listCalls, ['C1'], 'only member channels should be scanned');
    });

    it('tolerates history errors per channel', async () => {
      let posted = false;
      const client = {
        conversations: {
          list: async () => ({
            channels: [{ id: 'C1', name: 'broken', is_member: true }],
          }),
          history: async () => {
            throw new Error('missing_scope');
          },
          open: async () => ({ channel: { id: 'DM1' } }),
        },
        chat: {
          postMessage: async () => {
            posted = true;
            return { ok: true };
          },
        },
      };

      const result = await runDigestNow(client, { info: () => {}, warn: () => {} }, 'U_TARGET');
      assert.equal(result.count, 0);
      assert.ok(posted, 'digest should still be posted');
    });
  });
});
