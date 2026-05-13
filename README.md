# ReplyJoy

> An autonomous Gmail draft agent. ReplyJoy reads your inbox, decides which threads
> deserve a reply, and writes the draft directly back into Gmail — so the draft is
> waiting for you in the thread when you open it.

ReplyJoy is intentionally small. It does one thing, and Gmail stays the source of
truth: drafts live in Gmail, not in a separate UI you have to babysit.

- **Self-hostable.** Bring your own Gmail OAuth app, Clerk tenant, and Gemini key.
- **Inspectable.** TypeScript end-to-end, one Express server, one Vite frontend.
- **Extensible.** A small commercial-module interface lets you bolt on billing or
  other private features without forking.

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

You can give the agent custom drafting rules ("never commit to meeting times",
"sign off with my first name only") which it follows on every run.

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
│   ├── gmail-sync.ts        The agent loop
│   ├── model-client.ts      Gemini wrapper with retries
│   └── entitlements.ts      Pluggable access/billing interface
├── db/           Drizzle schema, client, migrations bootstrap
├── lib/          crypto, env, ids, logger, langsmith
└── commercial/   Loader + interface for private modules
```

A single sync timer in `backend/src/index.ts` fires every 60 seconds and walks
all connected accounts. Each account's run scans recent threads, processes them
through a small worker pool, and persists the results into `email_threads`,
`draft_replies`, and `thread_run_results`.

---

## Commercial extensions

ReplyJoy is structured so that proprietary features (billing, plan gating, etc.)
can be added without forking the core. The backend looks for two optional env
vars:

- `COMMERCIAL_MODULE_PATH` — a module exporting `createCommercialModule(context)`.
  It can register pre-JSON middleware (e.g. Stripe webhooks needing a raw body),
  a protected sub-router, and a custom `EntitlementsService`.
- `COMMERCIAL_MIGRATIONS_PATH` — an additional Drizzle migrations folder applied
  on startup, after the OSS migrations.

The frontend exposes the same hook through the `@replyjoy/commercial-frontend`
Vite alias. When neither is set, ReplyJoy runs in OSS mode with all features
unlocked.

---

## Contributing

Issues and PRs are welcome. Please open an issue describing the change before
sending a large PR — the project is small and stays small on purpose.

Run `npm run lint` and `npm test` before pushing.

---

## License

MIT. See [LICENSE](LICENSE).
