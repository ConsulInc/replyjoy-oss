# ReplyJoy

ReplyJoy connects to a user's Gmail account, scans the inbox for reply-worthy threads, and creates reply drafts back in Gmail.

The app is intentionally minimal:

- connect Gmail
- choose the agent provider and model
- edit drafting rules
- review the latest drafts

Gmail remains the source of truth for the draft itself.

## Stack

- TypeScript
- Express backend
- React + Vite frontend
- Clerk auth
- Postgres + Neon
- Drizzle ORM
- Tailwind CSS
- TanStack Query

## Local Setup

1. Copy `.env.example` to `.env`
2. Fill in the required env vars
3. Install dependencies:

```bash
npm install
```

4. Run the app:

```bash
npm run dev
```

Frontend:

- `http://localhost:5173`

Backend:

- `http://localhost:3000`

## Scripts

```bash
npm run dev
npm run lint
npm test
npm run build
```

## Notes

- The backend applies Drizzle migrations on startup.
- Gmail drafts are created and updated through the Gmail API.
- The sync loop currently runs on a one-minute interval.

## Extension Points

- Backend commercial features are loaded through `COMMERCIAL_MODULE_PATH`.
- Extra private migrations are loaded through `COMMERCIAL_MIGRATIONS_PATH`.
- Frontend commercial UI is loaded through the `@replyjoy/commercial-frontend` alias.
