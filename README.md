# ReplyJoy

**An autonomous Gmail draft agent.** ReplyJoy reads your inbox, decides which threads deserve a reply, and writes the draft directly back into Gmail — so the draft is waiting for you in the thread when you open it.

Before drafting, the agent reads your sent mail to learn your voice, searches prior threads for the facts it needs (so it doesn't fabricate dates, names, or commitments), and checks your Google Calendar before proposing meeting times. You can give it custom drafting rules — *"never commit to specific times"*, *"sign off as Derek"*, *"keep replies under three sentences"* — that it follows on every run.

ReplyJoy is intentionally small. It does one thing, and Gmail stays the source of truth: drafts live in Gmail, not in a separate UI you have to babysit.

- **Sounds like you.** Tone and phrasing are matched against your own sent history, not a generic LLM voice.
- **Grounded.** The agent only uses facts present in the current thread, your mailbox history, your calendar, or attachments it has read. If a fact is missing, it leaves it out or skips the draft.
- **Self-hostable.** Bring your own Gmail OAuth app, Clerk tenant, and Gemini key.
- **Inspectable.** TypeScript end-to-end, one Express server, one Vite frontend.

<!-- TODO: add a screenshot of the drafts dashboard here -->

---

## How it works

1. You connect a Gmail account via Google OAuth.
2. A one-minute sync loop pulls recent threads, filters out spam / promotions /
   social / updates / forums, and asks Gemini whether each remaining thread
   deserves a reply.
3. For threads that pass, the agent reads the thread, optionally searches mail
   history, optionally checks your calendar for availability, and writes a draft.
4. The draft is created (or updated) directly in the Gmail thread via the
   Gmail API. You review it inside Gmail.

---

## Customization

Once you've connected Gmail, the dashboard exposes a small set of controls:

- **Drafting rules.** Free-text instructions the agent applies to every draft. Useful for tone (*"warm and informal"*), constraints (*"never commit to specific meeting times"*), formatting (*"sign off as Derek, not Derek Bai"*), or language (*"reply in German if the sender wrote in German"*). Each rule is appended to the agent's system prompt at draft time. Add or remove rules at any time — changes take effect on the next sync.
- **Initial lookback.** When you first connect Gmail, choose how far back to backfill drafts: anywhere from 1 to 5 days of recent threads.
- **Autodraft on/off.** Pause draft generation entirely without disconnecting Gmail (e.g. while on vacation), then flip it back on when you want the agent running again.
- **Model.** Switch the underlying Gemini model. The OSS build defaults to `gemini-3-flash-preview`.

Settings live in the `user_settings` table and are scoped per user. You can also tweak them via `PATCH /api/settings` if you're scripting against the backend.

---

## Stack

| Layer        | Choice                                    |
| ------------ | ----------------------------------------- |
| Language     | TypeScript                                |
| Backend      | Express                                   |
| Frontend     | React + Vite + Tailwind + TanStack Query  |
| Auth         | Clerk                                     |
| Database     | SQLite (file in dev, Turso libSQL in prod)|
| ORM          | Drizzle                                   |
| AI provider  | Google Gemini                             |
| Mail / Cal   | Gmail API + Google Calendar API           |
| Tracing      | LangSmith (optional)                      |

---

## Quick start

You'll need Node 20+, a Google Cloud OAuth client with Gmail + Calendar scopes,
a Clerk application, and a Gemini API key.

```bash
git clone https://github.com/ConsulInc/replyjoy-oss.git
cd replyjoy-oss
cp .env.example .env
# fill in the required vars (see Configuration below)
npm install
npm run dev
```

- Frontend: http://localhost:5173
- Backend:  http://localhost:3000

The backend applies Drizzle migrations on startup, so you don't need a separate
migrate step.

---

## Configuration

| Variable                       | Required | Notes                                                   |
| ------------------------------ | -------- | ------------------------------------------------------- |
| `DATABASE_URL`                 | yes      | `file:./data/replyjoy.db` for local, `libsql://...` for Turso |
| `DATABASE_AUTH_TOKEN`          | prod     | Required when `DATABASE_URL` is a Turso URL              |
| `CLERK_PUBLISHABLE_KEY`        | yes      | From the Clerk dashboard                                |
| `CLERK_SECRET_KEY`             | yes      | From the Clerk dashboard                                |
| `VITE_CLERK_PUBLISHABLE_KEY`   | yes      | Same value, exposed to the frontend                     |
| `GOOGLE_CLIENT_ID`             | yes      | OAuth client with Gmail + Calendar scopes               |
| `GOOGLE_CLIENT_SECRET`         | yes      |                                                         |
| `GMAIL_TOKEN_ENCRYPTION_KEY`   | yes      | 32+ bytes of random hex; encrypts stored refresh tokens |
| `GEMINI_API_KEY`               | yes      | Drives the drafting agent                               |
| `RESEND_API_KEY`               | no       | For the contact form. Skip if you don't want one        |
| `SUPPORT_TO_EMAIL`             | no       | Where contact-form submissions go                       |
| `SUPPORT_FROM_EMAIL`           | no       | Must be verified in Resend                              |
| `LANGSMITH_API_KEY`            | no       | Enables LLM tracing                                     |
| `FRONTEND_URL` / `APP_URL`     | no       | Defaults to `http://localhost:5173` / `:3000`           |

See `.env.example` for a copy-pasteable template.

---

## Scripts

```bash
npm run dev      # backend + frontend in watch mode
npm run build    # production build of both
npm run lint     # typecheck backend and frontend
npm test         # vitest across backend and frontend
```

---

## Architecture

```
backend/src
├── routes/       Express routers (public + protected)
├── gmail/        Gmail/Calendar client + MIME helpers
├── services/
│   ├── gmail-sync.ts     The agent loop
│   └── model-client.ts   Gemini wrapper with retries
├── db/           Drizzle schema, client, migrations bootstrap
└── lib/          crypto, env, ids, logger, langsmith
```

A single sync timer in `backend/src/index.ts` fires every 60 seconds and walks
all connected accounts. Each account's run scans recent threads, processes them
through a small worker pool, and persists the results into `email_threads`,
`draft_replies`, and `thread_run_results`.

---

## Contributing

Issues and PRs are welcome. Please open an issue describing the change before
sending a large PR — the project is small and stays small on purpose.

Run `npm run lint` and `npm test` before pushing.

---

## License

MIT. See [LICENSE](LICENSE).
