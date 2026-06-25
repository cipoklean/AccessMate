import { chatComplete } from './llm.js';
import { sanitizeForSlack } from './sanitize.js';
import { downloadSlackFileAsDataUrl } from './slackHttp.js';

export const ALT_TEXT_PROMPT = `You generate alt text for images shared in Slack, for people who use screen readers.

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

/**
 * Download a Slack file image and generate alt text using the vision model.
 * Returns sanitized text ready for Slack display.
 */
export async function generateAltTextForFile(file, slackToken) {
  const dataUrl = await downloadSlackFileAsDataUrl(file.url_private, slackToken);
  const raw = await chatComplete({
    systemPrompt: ALT_TEXT_PROMPT,
    userContent: [
      { type: 'text', text: 'Write alt text for this image.' },
      { type: 'image_url', image_url: { url: dataUrl } },
    ],
    vision: true,
  });
  return sanitizeForSlack(raw);
}

/**
 * Find the most recent image file in a list of Slack messages.
 */
export function findMostRecentImage(messages) {
  for (const msg of messages) {
    if (!msg.files) continue;
    const img = msg.files.find((f) => f.mimetype?.startsWith('image/'));
    if (img) return img;
  }
  return null;
}

/**
 * Build a Block Kit card displaying the generated alt text.
 */
export function buildAltTextCard(altText, fileName) {
  const name = fileName || 'image';
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '🖼️ Alt text', emoji: true } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `For *${name}* · ${altText.length} chars` }] },
    { type: 'section', text: { type: 'mrkdwn', text: altText } },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `💡 Select the text above to copy it into your image's alt-text field` }],
    },
  ];
  return { text: `🖼️ Alt text for ${name}: ${altText}`, blocks };
}
