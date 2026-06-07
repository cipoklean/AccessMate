# AccessMate

> **Slack, for everyone.**

AccessMate is an accessibility companion that lives inside any Slack workspace and quietly makes it usable for people with disabilities — generating alt text for shared images, plain-language summaries of long threads, a screen-reader-friendly daily digest, and (stretch goal) live huddle captions.

Built for the [Slack Agent Builder Challenge](https://slackhack.devpost.com/) · **Slack Agent for Good** track.

---

## ✨ Features (MVP)

- `/accessmate alt` — generate alt text for any image (vision model)
- `/accessmate simplify` — plain-language rewrite of a long thread
- `@AccessMate` — context-aware Q&A using RTS API for thread context
- Daily digest DM — screen-reader-friendly summary of unread channels

## 🧩 Stack

- **Platform:** Slack AI Agent (next-gen platform, via Slack CLI)
- **Framework:** OpenAI Agents SDK on top of Slack Bolt for JavaScript
- **LLM:** Google Gemini 2.5 Flash Lite (OpenAI-compatible endpoint, vision-capable)
- **Slack APIs:** Slack AI (agent runtime) · Slack MCP server (actions) · RTS API (permission-aware retrieval)
- **Backup LLM:** AWS Bedrock Claude (once quota raise lands) or Groq Llama 3.3

## 🚀 Local development
