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
            const result = await runDigestNow(client, logger);
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

        default:
          await respond({
            text: '👋 Hi! Try `/accessmate ping`, `/accessmate alt`, `/accessmate simplify`, or `/accessmate digest`.',
            response_type: 'ephemeral',
          });
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