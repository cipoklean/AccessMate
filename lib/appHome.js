function buildHomeView() {
  return {
    type: 'home',
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: '🎯 AccessMate', emoji: true } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Slack, for everyone.*\nAccessibility companion that generates alt text for images, summarizes threads in plain language, and posts screen-reader-friendly digests.',
        },
      },
      { type: 'divider' },
      { type: 'header', text: { type: 'plain_text', text: '🖼️ Alt text', emoji: true } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Generate alt text for images so screen-reader users can understand them.\n• *Shortcut:* hover a message with an image → ⋯ → _Generate alt text_\n• *Slash:* `/accessmate alt` in a channel with a recent image',
        },
      },
      { type: 'divider' },
      { type: 'header', text: { type: 'plain_text', text: '📝 Simplify thread', emoji: true } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Plain-language summary of any thread at a 5th-grade reading level.\n• *Shortcut:* hover any message → ⋯ → _Simplify thread_\n• *Slash:* `/accessmate simplify <message-link>`',
        },
      },
      { type: 'divider' },
      { type: 'header', text: { type: 'plain_text', text: '📰 Accessibility digest', emoji: true } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Scans your channels for images missing alt text and DMs you a report.\n• *Slash:* `/accessmate digest` to run it now',
        },
      },
      { type: 'divider' },
      { type: 'header', text: { type: 'plain_text', text: 'Quick reference', emoji: true } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '• `/accessmate alt` — alt text for the most recent image\n• `/accessmate simplify <link>` — summarize a thread\n• `/accessmate digest` — run an alt-text audit\n• `/accessmate ping` — health check\n• `@AccessMate` — mention me in any channel I am in',
        },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: '🌍 Built for the Slack Agent Builder Challenge — Agent for Good track.' }],
      },
    ],
  };
}

export async function publishAppHome({ userId, client, logger }) {
  try {
    await client.views.publish({
      user_id: userId,
      view: buildHomeView(),
    });
  } catch (err) {
    logger?.error?.(`[appHome] publish failed: ${err?.data?.error || err?.message || err}`);
  }
}

export function registerAppHomeEvents(app) {
  app.event('app_home_opened', async ({ event, client, logger }) => {
    if (event.tab !== 'home') return;
    await publishAppHome({ userId: event.user, client, logger });
  });
}
