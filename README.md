# DAYLOCK

**Plan tonight. Execute tomorrow.**

DAYLOCK is a productivity and personal-growth platform combining a cinematic Life RPG experience with a calm, usable command centre.

## Current repository status

This is the initial frontend foundation with a responsive public landing page, isolated sample demo, and Firebase Email/Password authentication. Firestore user data, cloud timetable persistence, server-enforced midnight locking, XP reward transactions, and real Squad functionality are **not yet implemented**.

## Design direction

- Life RPG + Zen Minimal
- Deep forest charcoal, olive, lime and warm gold
- Cinematic landscapes and floating-island Growth World
- Practical, responsive desktop and mobile navigation
- Demo data is explicitly labelled and never represented as a real account

## Run locally

This starter uses Vite, React and TypeScript.

```bash
npm install
npm run dev
```

## Planned architecture

- Frontend: React + TypeScript + Vite
- Styling: CSS variables and responsive CSS
- Authentication: Firebase Email/Password (connected in this version). Firestore profile and schedule storage: next stage, after security rules are published.
- Hosting: Cloudflare Pages or another static frontend host (planned)

## Product rules

1. Users plan the next day's timetable before its local midnight lock.
2. At the scheduled date's midnight, that schedule becomes sealed.
3. After sealing, task status may change, but the original task definition may not.
4. Emergency amendments require a reason and an append-only audit record.
5. Every user's private data is isolated.
6. XP rewards must be granted idempotently on the server, never from repeatable client clicks.
7. No prefilled personal names, schedules, streaks or XP in new accounts.
8. Demo mode must remain separate from authenticated user data.

## Development stages

1. Landing page and responsive visual system
2. Firebase Email/Password authentication and persistent sessions
3. Firestore profile and schedule storage with owner-only rules
4. Timetable and server-side midnight locking
5. Growth World, quests, habits and milestones
6. Squad challenges and sharing permissions
7. Insights, notifications, security review and launch

## Security

Never commit API keys, Firebase service-account files, passwords, tokens or .env files. Use environment variables and host-provided secret storage for private configuration.
