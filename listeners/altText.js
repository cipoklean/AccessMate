import { downloadSlackFileAsDataUrl } from '../lib/slackHttp.js';
import { chatComplete, classifyLlmError } from '../lib/llm.js';
import { buildErrorCard } from '../lib/errorCard.js';

const ALT_TEXT_PROMPT = `You generate alt text for images shared in Slack, for people who use screen readers.

UNIVERSAL RULES:
- Reply with ONLY the alt text. No preamble, no quotes, no markdown formatting.
- Never start with "image of", "picture of", "photo of", "screenshot of", "app icon for", "logo of", "code for", or any equivalent. Start with the content itself.
- Plain language, no jargon, no emoji.
- Don't assume gender from appearance. Use "person" / "people" unless gender is explicitly stated (named, captioned, role-identified).
- If you cannot tell what the image is, reply exactly: "Unable to generate description."

ADAPT LENGTH AND CONTENT TO IMAGE TYPE:

• Logo / brand mark / app icon (target 40-80 chars):
  Format: "[Brand name] logo." + optional brief visual detail if it carries meaning.
  Example: "Proton VPN logo: white triangle in purple-to-blue gradient circle."

• Chart / graph / data visualization (target 80-125 chars):
  Lead with the KEY INSIGHT, then specific numbers. Not the chart type.
  Example: "Bitcoin in volatile downtrend, currently $60,925, down $117."

• UI screenshot / app interface (target 100-150 chars):
  Identify the app (VS Code, Slack, Figma, Chrome, etc.) if recognizable. Describe what content or action is shown, not just element names.
  Example: "VS Code editor showing a React 'Borrow' component that uses wallet hooks to handle user lending actions."

• Photo of a real-world scene (target 100-125 chars):
  Subject + 2-3 key visual details + setting. Neutral language for people.
  Example: "A person in an orange t-shirt and black shorts stands outside a building, surrounded by pink flowers."

• Text-heavy infographic / poster / slide (no strict length cap, but be concise):
  Capture visible text verbatim. Describe layout only if it adds meaning.
  Prioritize text content over visual description.

If an image fits multiple types, prefer the more specific one.`;

async function generateAltTextForFile(file, slackToken) {
  const dataUrl = await downloadSlackFileAsDataUrl(file.url_private, slackToken);
  return chatComplete({
    systemPrompt: ALT_TEXT_PROMPT,
    userContent: [
      { type: 'text', text: 'Write alt text for this image.' },
      { type: 'image_url', image_url: { url: dataUrl } },
    ],
  });
}

function findMostRecentImage(messages) {
  for (const msg of messages) {
    if (!msg.files) continue;
    const img = msg.files.find((f) => f.mimetype?.startsWith('image/'));
    if (img) return img;
  }
  return null;
}

function buildAltTextCard(altText, fileName) {
    const name = fileName || 'image';
    const blocks = [
        { type: 'header', text: { type: 'plain_text', text: '🖼️ Alt text', emoji: true } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: `For *${name}* · ${altText.length} chars` }] },
        { type: 'section', text: { type: 'mrkdwn', text: altText } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: `💡 Select the text above to copy it into your image's alt-text field` }] },
    ];
    return { text: `🖼️ Alt text for ${name}: ${altText}`, blocks };
}

export async function handleAltText({ command, respond, client, context }) {
  let history;
  try {
    history = await client.conversations.history({ channel: command.channel_id, limit: 20 });
  } catch (err) {
    await respond({
      response_type: 'ephemeral',
      ...buildErrorCard({ title: "Can't read this channel", body: `\`${err.data?.error || err.message}\``, hint: 'Invite me with `/invite @AccessMate`, or use the right-click *Generate alt text* shortcut on a message with an image.' }),
    });
    return;
  }

  const image = findMostRecentImage(history.messages || []);
  if (!image) {
    await respond({
      response_type: 'ephemeral',
      ...buildErrorCard({ title: 'No image found', body: "I scanned the last 20 messages but didn't see any images.", hint: 'Upload an image to this channel, or right-click any message with an image and choose *Generate alt text*.' }),
    });
    return;
  }

  try {
    const slackToken = context.botToken || process.env.SLACK_BOT_TOKEN;
    const altText = await generateAltTextForFile(image, slackToken);
    await respond({ response_type: 'ephemeral', ...buildAltTextCard(altText, image.name) });
  } catch (err) {
    await respond({ response_type: 'ephemeral', ...buildErrorCard({ title: 'Alt text generation failed', body: classifyLlmError(err), hint: 'Try again in a moment. If this persists, the image format may not be supported.' }) });
  }
}

export function registerAltTextShortcut(app) {
  app.shortcut('generate_alt_text', async ({ shortcut, ack, respond, client, context, logger }) => {
    await ack();
    try {
      const image = shortcut.message.files?.find((f) => f.mimetype?.startsWith('image/'));
      if (!image) {
        await respond({ response_type: 'ephemeral', ...buildErrorCard({ title: 'No image on this message', body: "This message doesn't have an image attached.", hint: 'Use the *Generate alt text* shortcut on a message with an image, or run `/accessmate alt` in a channel.' }) });
        return;
      }
      const slackToken = context.botToken || process.env.SLACK_BOT_TOKEN;
      const altText = await generateAltTextForFile(image, slackToken);
      await respond({ response_type: 'ephemeral', ...buildAltTextCard(altText, image.name) });
    } catch (err) {
      logger?.error?.(`AltText shortcut error: ${err}`);
      try {
        await respond({ response_type: 'ephemeral', ...buildErrorCard({ title: 'Alt text generation failed', body: classifyLlmError(err), hint: 'Try again in a moment. If this persists, the image format may not be supported.' }) });
      } catch {}
    }
  });
}