# Pinky Promise

A two-phone game about trust, cooperation, and the temptation to defect.

**Play:** https://robin1844.github.io/pinky-promise/

The game screen is published from [`docs/index.html`](docs/index.html) on GitHub Pages. GitHub Pages serves static files, so the shared room state lives in a small Cloudflare Worker backed by D1. Its source is in [`app/api/[action]/route.ts`](app/api/%5Baction%5D/route.ts), with the database schema in [`db/schema.ts`](db/schema.ts).

One team creates a room and chooses a secret emoji. The other enters the three-digit room number and matches the emoji. Both phones then submit private choices, reveal the result together, and track coins through ten rounds. Either team can start another game in the same room after the ending.

## Local API development

Requires Node.js 22 or later.

```sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_flaky_whirlwind.sql
npm start
```

The published GitHub Page uses the hosted API URL configured near the top of `docs/index.html`.

Rooms expire after four hours. The three-digit room number and five-emoji match are a playful pairing step, not strong authentication.
