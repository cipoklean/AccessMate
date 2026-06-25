import { buildAltTextCard, findMostRecentImage, generateAltTextForFile } from '../lib/altTextService.js';
import { buildErrorCard } from '../lib/errorCard.js';
import { classifyLlmError } from '../lib/llm.js';

export async function handleAltText({ command, respond, client, context, logger }) {
  let history;
  try {
    history = await client.conversations.history({ channel: command.channel_id, limit: 20 });
  } catch (err) {
    logger?.error?.('[altText] failed to read channel:', err);
    await respond({
      response_type: 'ephemeral',
      ...buildErrorCard({
        title: "Can't read this channel",
        body: "I don't have permission to view messages here.",
        hint: 'Invite me with `/invite @AccessMate`, or use the right-click *Generate alt text* shortcut on a message with an image.',
      }),
    });
    return;
  }

  const image = findMostRecentImage(history.messages || []);
  if (!image) {
    await respond({
      response_type: 'ephemeral',
      ...buildErrorCard({
        title: 'No image found',
        body: "I scanned the last 20 messages but didn't see any images.",
        hint: 'Upload an image to this channel, or right-click any message with an image and choose *Generate alt text*.',
      }),
    });
    return;
  }

  try {
    const slackToken = context.botToken || process.env.SLACK_BOT_TOKEN;
    const altText = await generateAltTextForFile(image, slackToken);
    await respond({ response_type: 'ephemeral', ...buildAltTextCard(altText, image.name) });
  } catch (err) {
    logger?.error?.('[altText] generation failed:', err);
    await respond({
      response_type: 'ephemeral',
      ...buildErrorCard({
        title: 'Alt text generation failed',
        body: classifyLlmError(err, { task: 'alt-text', detail: `(Image: ${image.name})` }),
        hint: 'Try again in a moment. If this persists, the image format may not be supported.',
      }),
    });
  }
}

export function registerAltTextShortcut(app) {
  app.shortcut('generate_alt_text', async ({ shortcut, ack, respond, client, context, logger }) => {
    await ack();
    try {
      const image = shortcut.message.files?.find((f) => f.mimetype?.startsWith('image/'));
      if (!image) {
        await respond({
          response_type: 'ephemeral',
          ...buildErrorCard({
            title: 'No image on this message',
            body: "This message doesn't have an image attached.",
            hint: 'Use the *Generate alt text* shortcut on a message with an image, or run `/accessmate alt` in a channel.',
          }),
        });
        return;
      }
      const slackToken = context.botToken || process.env.SLACK_BOT_TOKEN;
      const altText = await generateAltTextForFile(image, slackToken);
      await respond({ response_type: 'ephemeral', ...buildAltTextCard(altText, image.name) });
    } catch (err) {
      logger?.error?.('[altText shortcut] error:', err);
      try {
        await respond({
          response_type: 'ephemeral',
          ...buildErrorCard({
            title: 'Alt text generation failed',
            body: classifyLlmError(err, { task: 'alt-text', detail: `(Image: ${image.name})` }),
            hint: 'Try again in a moment. If this persists, the image format may not be supported.',
          }),
        });
      } catch (notifyErr) {
        logger?.error?.('[altText shortcut] failed to notify user:', notifyErr);
      }
    }
  });
}
