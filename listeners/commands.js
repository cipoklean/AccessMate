import { handleAltText } from './altText.js';
import { handleSimplifySlash } from './simplify.js';
import { runDigestNow } from './digest.js';

export function registerAccessMateCommand(app) {
  app.command('/accessmate', async ({ command, ack, respond, client, context, logger }) => {
    // ALWAYS ack first — within 3 seconds, no matter what
    await ack();

    // Wrap everything else so no error ever bubbles up to Bolt
    try {
      const subcommand = (command.text || '').trim().split(' ')[0].toLowerCase();

      switch (subcommand) {
        case 'ping':
          await respond({
            text: '🏓 pong! AccessMate routing works.',
            response_type: 'ephemeral',
          });
          break;

        case 'alt':
          await handleAltText({ command, respond, client, context });
          break;

        case 'simplify':
          await handleSimplifySlash({ command, respond, client, context, logger });
          break;

        case 'digest': {
          await respond({ text: '⏳ Scanning channels for alt-text gaps...', response_type: 'ephemeral' });
          try {
            const result = await runDigestNow(client, logger, command.user_id);
            if (result.error) {
              await respond({ text: `❌ ${result.error}`, response_type: 'ephemeral', replace_original: false });
            } else {
              await respond({
                text: `✅ Digest sent to your DMs — ${result.count} alt-text gap${result.count === 1 ? '' : 's'} found.`,
                response_type: 'ephemeral',
                replace_original: false,
              });
            }
          } catch (err) {
            await respond({ text: `❌ Digest failed: ${err?.message || 'unknown'}`, response_type: 'ephemeral', replace_original: false });
          }
          break;
        }

        default: {
          await respond({
            response_type: 'ephemeral',
            text: 'AccessMate help — generate alt text, simplify threads, on-demand accessibility digest, and health check. Right-click any message for the fastest path.',
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: '👋 *AccessMate* — Slack accessibility, by default.\nTwo primitives + an on-demand audit, all in your message flow.',
                },
              },
              { type: 'divider' },
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text:
                    '*Commands*\n\n' +
                    '🖼️ `/accessmate alt` — Generate alt text for an image. Best path: right-click any image message → *More message shortcuts* → *Generate alt text*.\n\n' +
                    '🧵 `/accessmate simplify` — Plain-language summary of a long thread. Best path: right-click any message in the thread → *Simplify thread*.\n\n' +
                    '🦻 `/accessmate digest` — DMs you every image posted in the last 24 hours that\'s missing alt text, with one-tap fix links per file.\n\n' +
                    '🏓 `/accessmate ping` — Health check. Returns *pong* if AccessMate is running.',
                },
              },
              {
                type: 'context',
                elements: [
                  {
                    type: 'mrkdwn',
                    text: '💡 *Tip:* visit the *AccessMate* App Home tab for a guided overview. All commands return ephemeral cards — only you see them.',
                  },
                ],
              },
            ],
          });
          break;
        }
      }
    } catch (err) {
      logger?.error('AccessMate command error:', err);
      console.error('AccessMate command error:', err);
      try {
        await respond({
          text: `⚠️ Something went wrong: \`${err?.message || 'unknown error'}\``,
          response_type: 'ephemeral',
        });
      } catch (_) {
        // Silent — already logged
      }
    }
  });
}