# Community Reply Assistant

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/TypeScript-5-blue?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Prisma-2D3748?logo=prisma" alt="Prisma" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-38bdf8?logo=tailwindcss" alt="Tailwind CSS 4" />
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="MIT" />
</p>


## Demo

https://github.com/user-attachments/assets/demo.mp4

> _Generated with [demo-video-generator](https://github.com/zan-maker/demo-video-generator)_
**Free, open-source tool that helps domain experts provide thoughtful, helpful answers to business questions on Reddit.**

## The Problem

Every day, thousands of people on Reddit ask questions like:

> "What's the best tool for managing client invoices?"
> "Has anyone tried [tool]? Is it worth it?"
> "We're a 5-person team and can't figure out our workflow."

These questioners need **genuine, expert advice** — not self-promotional spam. But the people best qualified to help (fractional CFOs, business acquisition advisors, operations consultants) don't have time to manually monitor dozens of subreddits looking for questions they can answer.

## The Public Good

This project solves that by:

1. **Scanning relevant subreddits** for threads where people are asking for advice in specific domains (finance, operations, business strategy)
2. **Scoring threads** by engagement and buying-intent signals to surface the most valuable conversations
3. **Drafting helpful replies** that sound like a knowledgeable community member, not an ad
4. **Sending a daily digest** so experts can review and post genuinely useful answers in minutes

The net effect is **better answers for Reddit users** and **reduced self-promotional noise** — because businesses that have an efficient way to contribute value tend to engage authentically rather than spamming.

## How It Works

- Monitors subreddits like r/smallbusiness, r/startups, r/Entrepreneur, r/SaaS, and more
- Uses AI to detect buying-intent signals (comparing options, expressing frustration, asking for recommendations)
- Scores each thread 0–100 based on engagement + relevance
- Generates draft replies that follow Reddit etiquette (no company mentions, no links, no marketing language)
- Delivers a daily email digest with the top opportunities

## Tech Stack

- **Next.js 16** with App Router
- **TypeScript** throughout
- **Prisma** (SQLite) for data storage
- **Tailwind CSS** + **shadcn/ui** for the dashboard
- **snoowrap** for Reddit API integration
- **AI reply drafting** via LLM

## Setup

1. Clone the repo and install dependencies:
   ```bash
   git clone https://github.com/zan-maker/community-reply-assistant.git
   cd community-reply-assistant
   bun install
   ```

2. Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   cp .env.example .env
   ```

3. Create a Reddit app at https://www.reddit.com/prefs/apps (script type)

4. Run the development server:
   ```bash
   bun run dev
   ```

## License

MIT — free to use, modify, and distribute.

---

## CHP Governance

This repository is hardened with the [Consensus Hardening Protocol (CHP)](https://codeberg.org/cubiczan/consensus-hardening-protocol), Cubiczan's decision-governance layer for multi-agent AI systems.

### Protocol Layers
- **R0 Gate**: All decisions must pass Solvable, Scoped, Valid, Worth_it checks
- **Foundation Disclosure**: 1-3 weakest assumptions, 1-2 invalidation conditions, 1 key vulnerability
- **Adversarial Layer**: Mandatory devil's advocate at Phase 0 and Round 3
- **State Machine**: EXPLORING → PROVISIONAL → PROVISIONAL_LOCK → LOCKED
- **Third-Party Validation**: Independent CONFIRM/REJECT before lock

### Domain Configuration
- **Category**: AI / Agents
- **Foundation Threshold**: 70
- **CFO Accuracy Guard**: Disabled

### Compliance Artifacts
| File | Purpose |
|------|---------|
| `.chp/STATE_MACHINE.md` | Decision state transitions |
| `.chp/R0_CONFIG.yaml` | Domain-calibrated thresholds |
| `.chp/ADVERSARIAL_PROMPTS.md` | Standardized challenge templates |
| `.chp/CHP_COMPLIANCE.md` | Compliance tracking & audit trail |

### CHP Version
cognitive-mesh-orchestrator 0.1.0 | [Protocol Docs](https://codeberg.org/cubiczan/consensus-hardening-protocol)

