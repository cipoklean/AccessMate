# AccessMate

> **Slack, for everyone.**

Accessibility companion bot that generates alt text for images, summarizes threads in plain language, answers questions about conversations, and audits your workspace for missing alt text — all from inside Slack.

---

## Features

### 🖼️ Alt Text Generation
Generate a description for any image so screen-reader users can understand it.
- **Shortcut:** Hover a message with an image → ⋯ → *Generate alt text*
- **Slash command:** `/accessmate alt` in a channel with a recent image

### 📝 Simplify Thread
Plain-language summary of any thread, rewritten at a 5th-grade reading level for cognitive accessibility.
- **Shortcut:** Hover any message → ⋯ → *Simplify thread*
- **Slash command:** `/accessmate simplify <message-link>`

### 🦻 On-Demand Digest
DMs you every image posted in the last 24 hours that's missing alt text, with direct links to each image so you can open them and generate alt text.
- **Slash command:** `/accessmate digest`

### 💬 Mention Q&A
Mention `@AccessMate` in any thread to ask a question about the conversation. It reads the thread context and answers directly.
- Mention with an attached image → describes the image
- Mention in a thread reply → answers your question using thread context
- Standalone mention → shows help message

---

## Architecture

```
app.js                    Entry point — Bolt app, Socket Mode, keep-alive server
├── listeners/
│   ├── commands.js      /accessmate slash command router
│   ├── altText.js        Alt text shortcut + slash handler
│   ├── simplify.js       Simplify shortcut + slash handler
│   ├── mention.js        @mention handler (Q&A + vision routing)
│   ├── digest.js         Alt-text gap audit + digest builder (called from commands.js)
├── lib/
│   ├── llm.js            Provider registry, fallback chain, chatComplete
│   ├── altTextService.js Shared alt-text logic (prompt, download, card)
│   ├── sanitize.js       Slack markup stripping + output sanitization
│   ├── slackHttp.js      SSRF-safe Slack file downloads
│   ├── handler.js        Error-catching handler wrapper
│   ├── errorCard.js      Consistent error card builder
│   └── appHome.js        App Home tab view
└── tests/                142 tests (node:test)
```

### AI Provider Abstraction

AccessMate uses a **provider registry** pattern with automatic failover:

| Provider | Model | Vision | Free Tier |
|----------|-------|--------|-----------|
| Gemini (default) | gemini-2.5-flash | ✅ | Yes (Google AI Studio) |
| OpenAI | gpt-4o-mini | ✅ | No |
| Groq | llama-3.3-70b-versatile | ❌ | Yes |

- Set `LLM_PROVIDER` to choose the primary provider (defaults to `gemini`)
- Set a fallback provider's API key to enable **automatic failover** on rate limits, auth errors, server outages, or network failures
- Vision requests (alt text) automatically skip text-only providers like Groq

### Security

- **SSRF protection** — Slack file downloads are restricted to `files.slack.com` and `files-private.slack.com` hostnames only (including redirect targets)
- **Prompt injection prevention** — All Slack markup (`<@U...>`, `<!channel>`, link refs, etc.) is stripped before sending to the LLM
- **Output sanitization** — LLM output is sanitized (`<` → `‹`) before posting to Slack to prevent markup injection
- **Error message sanitization** — Raw `err.message` is never shown to users; only generic, context-aware messages
- **TLS 1.2+** enforced for all outbound HTTPS connections
- **`ignoreSelf: true`** prevents the bot from responding to its own messages
- **Rate-limited `/health` endpoint** with security headers (used for Render keep-alive)

---

## Setup

### Prerequisites
- Node.js 18+
- A [Slack app](https://api.slack.com/apps) with Socket Mode enabled
- An API key from [Google AI Studio](https://aistudio.google.com/apikey) (free)

### Install

```bash
git clone <your-repo-url>
cd accessmate
npm install
cp .env.sample .env
```

### Configure

Edit `.env` with your credentials:

```bash
# Required — Slack tokens
SLACK_BOT_TOKEN=xoxb-YOUR-BOT-TOKEN
SLACK_APP_TOKEN=xapp-YOUR-APP-TOKEN

# Required — AI provider API key
GEMINI_API_KEY=your-google-ai-studio-key

# Optional — fallback provider (enables auto-failover)
GROQ_API_KEY=your-groq-key
```

### Slack App Permissions

The bot needs these scopes:
- `chat:write` — post messages
- `channels:history`, `groups:history`, `im:history`, `mpim:history` — read messages
- `files:read` — access file metadata for alt text
- `app_mentions:read` — receive @mentions
- `commands` — handle slash commands

### Events & Shortcuts

Subscribe to these events:
- `app_mention`
- `app_home_opened`

Register these shortcuts (message shortcuts):
- `simplify_thread`
- `generate_alt_text`

### Run

```bash
npm start
```

Or with the Slack CLI for local development:

```bash
slack run
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SLACK_BOT_TOKEN` | ✅ | — | Bot User OAuth Token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | ✅ | — | Socket Mode token (`xapp-...`) |
| `GEMINI_API_KEY` | ✅\* | — | Google AI Studio API key (required if `LLM_PROVIDER=gemini`) |
| `LLM_PROVIDER` | ❌ | `gemini` | Primary AI provider: `gemini`, `openai`, or `groq` |
| `LLM_MODEL` | ❌ | provider default | Override the default model for the active provider |
| `GROQ_API_KEY` | ❌ | — | Groq API key (enables fallback for text tasks) |
| `OPENAI_API_KEY` | ❌ | — | OpenAI API key (enables fallback, or use as primary) |
| `LOG_LEVEL` | ❌ | `INFO` | Log verbosity: `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `PORT` | ❌ | `3000` | HTTP port for keep-alive server |

\* At least one provider API key matching `LLM_PROVIDER` is required.

---

## Commands

| Command | Description |
|---------|-------------|
| `/accessmate` | Show help menu with all commands |
| `/accessmate alt` | Generate alt text for the most recent image in the channel |
| `/accessmate simplify <message-link>` | Plain-language summary of a thread |
| `/accessmate digest` | DM a report of images missing alt text (last 24h) |
| `/accessmate ping` | Health check — returns pong if the bot is running |

---

## Development

```bash
# Run tests
npm test

# Lint
npm run lint

# Lint + auto-fix
npm run lint:fix

# Type-check
npm run check
```

### Test Suite

142 tests using Node.js built-in test runner (`node:test`) covering:
- Provider abstraction and fallback chain logic
- Error classification with context-aware graceful degradation
- Input sanitization (Slack markup stripping, output escaping)
- SSRF protection on Slack file downloads
- TLS agent configuration
- All listeners (alt text, simplify, digest, mention, commands)
- Error card and handler wrapper behavior
- App Home view rendering

---

## License

MIT
