import OpenAI from 'openai';
import https from 'node:https';
import { URL } from 'node:url';

const slackHttpsAgent = new https.Agent({
  keepAlive: false,
  rejectUnauthorized: true,
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.2',
});

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


/**
 * Gemini Vision client (reuses the same Gemini OpenAI-compat endpoint).
 */
const visionClient = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
});


/**
 * Download a Slack file via Node's https module, with TLS 1.2 + curl UA
 * to work around middlebox interference (corporate antivirus, ISP DPI).
 */
function downloadSlackFile(urlStr, slackToken, redirectsLeft = 2) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'GET',
        agent: slackHttpsAgent,
        headers: {
          Authorization: `Bearer ${slackToken}`,
          // Mimic curl — many middleboxes whitelist it and block "Node*"
          'User-Agent': 'curl/8.4.0',
          Accept: '*/*',
          Connection: 'close',
        },
        timeout: 15000,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
          console.log('[alt helper] following redirect to:', res.headers.location);
          return downloadSlackFile(res.headers.location, slackToken, redirectsLeft - 1).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Slack returned HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      },
    );
    req.on('error', (err) => {
      console.error('[alt helper] https req error:', err.code, err.message);
      reject(err);
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Download timed out after 15s'));
    });
    req.end();
  });
}

/**
 * Retry wrapper around downloadSlackFile.
 * Slack's file CDN occasionally drops connections (ECONNRESET) on flaky
 * networks — a quick retry almost always succeeds.
 */
async function downloadSlackFileWithRetry(urlStr, slackToken, maxRetries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[alt helper] download attempt ${attempt}/${maxRetries}…`);
      return await downloadSlackFile(urlStr, slackToken);
    } catch (err) {
      lastErr = err;
      console.error(`[alt helper] attempt ${attempt} failed:`, err.code || err.message);

      // Don't retry on auth errors — they won't fix themselves
      if (err.message?.includes('HTTP 401') || err.message?.includes('HTTP 403')) {
        throw err;
      }

      // Exponential backoff: 500ms, 1s, 2s
      if (attempt < maxRetries) {
        const delay = 500 * Math.pow(2, attempt - 1);
        console.log(`[alt helper] retrying in ${delay}ms…`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}


/**
 * SHARED HELPER: download a Slack file and run it through Gemini Vision.
 */
async function generateAltTextForFile(file, slackToken) {
  console.log('[alt helper] ───── start');
  console.log('[alt helper] url:', file.url_private);
  console.log('[alt helper] token present:', slackToken ? `yes (${slackToken.slice(0, 12)}...)` : 'NO TOKEN');
  console.log('[alt helper] mimetype:', file.mimetype);
  console.log('[alt helper] size:', file.size);

  // Download via Node https module (more reliable than fetch on Windows)
console.log('[alt helper] downloading image via https module…');
let buf;
try {
  buf = await downloadSlackFileWithRetry(file.url_private, slackToken);
} catch (err) {
  console.error('[alt helper] download failed:', err.message);
  throw new Error(`Couldn't download the image: ${err.message}`);
}
console.log('[alt helper] downloaded bytes:', buf.length);
const base64 = buf.toString('base64');

  // Gemini call with 30s timeout, max 1 retry
  console.log('[alt helper] calling Gemini…');
  const t0 = Date.now();
  const completion = await visionClient.chat.completions.create(
    {
      model: 'gemini-2.5-flash-lite',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: ALT_TEXT_PROMPT },
            {
              type: 'image_url',
              image_url: {
                url: `data:${file.mimetype || 'image/jpeg'};base64,${base64}`,
              },
            },
          ],
        },
      ],
    },
    {
      timeout: 30000,
      maxRetries: 1,
    },
  );
  console.log('[alt helper] Gemini responded in', Date.now() - t0, 'ms');

  const altText = completion.choices[0]?.message?.content?.trim();
  if (!altText) throw new Error('Empty response from vision model');
  console.log('[alt helper] alt text length:', altText.length);
  console.log('[alt helper] ───── end');
  return altText;
}

/**
 * Find the most recent image in the channel's last 20 messages.
 */
function findMostRecentImage(messages) {
  for (const msg of messages) {
    if (!msg.files) continue;
    const img = msg.files.find((f) => f.mimetype?.startsWith('image/'));
    if (img) return img;
  }
  return null;
}

export async function handleAltText({ command, respond, client, context }) {
  // 1. Pull history to find an image
  let history;
  try {
    history = await client.conversations.history({
      channel: command.channel_id,
      limit: 20,
    });
  } catch (err) {
    await respond({
      response_type: 'ephemeral',
      text: `🖼️ I can't read this channel's history. Invite me with \`/invite @AccessMate\` or use the right-click message shortcut instead.\n\`${err.data?.error || err.message}\``,
    });
    return;
  }

  const image = findMostRecentImage(history.messages || []);
  if (!image) {
    await respond({
      response_type: 'ephemeral',
      text: '🖼️ I couldn\'t find a recent image. Upload an image to this channel and try again, or use the right-click message shortcut.',
    });
    return;
  }

  // 2. Generate alt text (silent — no "Generating..." message)
  let altText;
  try {
    const slackToken = context.botToken || process.env.SLACK_BOT_TOKEN;
    altText = await generateAltTextForFile(image, slackToken);
  } catch (err) {
    console.error('[alt cmd] generation error:', err);
    await respond({
      response_type: 'ephemeral',
      text: `🖼️ Couldn't generate alt text: \`${err.message}\``,
    });
    return;
  }

  // 3. Send result as ephemeral — only the requester sees it
  await respond({
    response_type: 'ephemeral',
    text: `🖼️ *Alt text for ${image.name || 'image'}:*\n> ${altText}\n\n_Copy this and use Slack's "Edit image details" on the image to apply it._`,
  });
}

/**
 * REGISTRATION: Register the message shortcut handler with the Bolt app.
 */
export function registerAltTextShortcut(app) {
  app.shortcut('generate_alt_text', async ({ shortcut, ack, respond, client, context, logger }) => {
  await ack();

  try {
    const message = shortcut.message;

    // 1. Find an image in the message
    const image = message.files?.find((f) => f.mimetype?.startsWith('image/'));
    if (!image) {
      await respond({
        response_type: 'ephemeral',
        text: '🖼️ This message doesn\'t contain an image.',
      });
      return;
    }

    // 2. Generate alt text (silent)
    const slackToken = context.botToken || process.env.SLACK_BOT_TOKEN;
    const altText = await generateAltTextForFile(image, slackToken);

    // 3. Send result as ephemeral
    await respond({
      response_type: 'ephemeral',
      text: `🖼️ *Alt text for ${image.name || 'image'}:*\n> ${altText}\n\n_Copy this and use Slack's "Edit image details" on the image to apply it._`,
    });
  } catch (err) {
    logger?.error('AltText shortcut error:', err);
    console.error('[alt shortcut] error:', err);
    try {
      await respond({
        response_type: 'ephemeral',
        text: `⚠️ Something went wrong: \`${err?.message || 'unknown error'}\``,
      });
    } catch (_) {
      // silent
    }
  }
});
}