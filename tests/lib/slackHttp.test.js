import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { slackHttpsAgent } from '../../lib/slackHttp.js';

describe('slackHttp.js', () => {
  describe('slackHttpsAgent', () => {
    it('rejects unauthorized TLS certs', () => {
      assert.equal(slackHttpsAgent.options.rejectUnauthorized, true);
    });

    it('requires TLS 1.2 or higher', () => {
      assert.equal(slackHttpsAgent.options.minVersion, 'TLSv1.2');
    });

    it('does NOT cap at TLS 1.2 (allows 1.3)', () => {
      // maxVersion should not be locked to TLSv1.2 — that blocks 1.3 negotiation
      assert.notEqual(slackHttpsAgent.options.maxVersion, 'TLSv1.2');
    });

    it('disables keepAlive (short-lived file downloads)', () => {
      assert.equal(slackHttpsAgent.options.keepAlive, false);
    });
  });

  describe('downloadSlackFileAsDataUrl', () => {
    it('throws when no token is available', async () => {
      const { downloadSlackFileAsDataUrl } = await import('../../lib/slackHttp.js');
      // Temporarily clear the env token
      const saved = process.env.SLACK_BOT_TOKEN;
      delete process.env.SLACK_BOT_TOKEN;
      try {
        await assert.rejects(() => downloadSlackFileAsDataUrl('https://files.slack.com/file'), /No Slack token/);
      } finally {
        if (saved) process.env.SLACK_BOT_TOKEN = saved;
      }
    });

    it('throws on non-Slack hostnames (SSRF protection)', async () => {
      const { downloadSlackFile } = await import('../../lib/slackHttp.js');
      await assert.rejects(
        () => downloadSlackFile('https://evil.example.com/file', 'fake-token', 1),
        /disallowed host/i,
      );
    });

    it('throws on localhost (SSRF protection)', async () => {
      const { downloadSlackFile } = await import('../../lib/slackHttp.js');
      await assert.rejects(
        () => downloadSlackFile('http://127.0.0.1:8080/internal', 'fake-token', 1),
        /disallowed host/i,
      );
    });

    it('throws on internal metadata endpoint (SSRF protection)', async () => {
      const { downloadSlackFile } = await import('../../lib/slackHttp.js');
      await assert.rejects(
        () => downloadSlackFile('http://169.254.169.254/latest/meta-data', 'fake-token', 1),
        /disallowed host/i,
      );
    });

    it('does not block allowed Slack hostnames on SSRF check', async () => {
      // We can't easily verify the allow-pass without making a real connection.
      // Instead, verify the allowlist logic indirectly: a subdomain of slack.com
      // should NOT be rejected with the SSRF error. We use a port that refuses
      // connections so this fails fast with a network error, NOT an SSRF block.
      const { downloadSlackFile } = await import('../../lib/slackHttp.js');
      await assert.rejects(
        () => downloadSlackFile('https://files.slack.com:1/file-pri/B123', 'fake-token', 1),
        (err) => {
          // Must NOT be an SSRF block — allowed host, just a connection failure
          assert.ok(!/disallowed host/i.test(err.message), `files.slack.com must be allowed, got: ${err.message}`);
          return true;
        },
      );
    });
  });
});
