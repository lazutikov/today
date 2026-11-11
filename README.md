# today

Same-day offline meetups. Landing at `/`, clickable prototype at `/app` (`/app#lviv` for Lviv).

## Run locally

    npm install
    npm run dev

## Deploy (Vercel)

1. Import this repo in Vercel. Framework preset: Vite (build settings come from `vercel.json`).
2. Environment variables (Settings → Environment Variables), see `.env.example`:
   - `VITE_TG_BOT_ID`, `VITE_TG_BOT_NAME`: the bot from @BotFather
   - `TELEGRAM_BOT_TOKEN`: the full bot token, server only, never commit it
   - `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`: PostHog EU project
3. In @BotFather: `/setdomain` → the Vercel domain, so Telegram Login works there.
4. Redeploy after changing env vars (the `VITE_` ones are baked in at build time).

Without the env vars the app falls back to a fake login and logs events to the console.
