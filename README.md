# Stravify

Link a Strava account and either Last.fm or Spotify. When a run finishes, Stravify pulls the tracks played during it, computes a genre breakdown, writes a short summary plus a shareable link into the Strava activity description, and saves the play history so the dashboard can show your most-played running tracks over time.

Live at https://stravify.net.

## How it works

1. Sign up with email (AWS Cognito user pool, SRP flow).
2. Link Strava and a music source (Last.fm is recommended — no 50-track cap; Spotify works but only exposes the last 50 plays).
3. Stravify subscribes to Strava's webhook so it's notified the moment a run ends.
4. A Lambda fetches the tracks played within the run's start/end window from Last.fm (or Spotify if that's all you have).
5. Artist genres/tags get normalized (`k-pop`, `kpop`, `korean` all collapse to `k-pop`), bucketed to top 8, and written back to the Strava activity description as a short summary + a link to `https://stravify.net/run/<id>`.
6. The detail page is public — anyone with the link can see a pie chart of genres and the full track list.

## Architecture

```
Browser (Netlify static site — Vite + React + TS)
  │
  ▼
Cognito User Pool ── SRP sign-in ──► id + refresh tokens (localStorage)
  │
  ▼
API Gateway HTTP API
  ├── JWT authorizer (Cognito) ──► /api/* + /auth/*/start
  └── public ────────────────────► /auth/*/callback, /api/runs/{id}, /webhooks/strava
  │
  ▼
Lambdas ──► DynamoDB (Users, Activities, SongPlays, OAuthState)
  │  │
  │  └──► Secrets Manager (stravify/strava, stravify/spotify, stravify/lastfm)
  │
  ▼
Strava + Spotify + Last.fm APIs

Strava webhook ─► API Gateway /webhooks/strava ─► Lambda ─► (pull music, write description, store)
```

## Project layout

```
frontend/    Vite + React + TypeScript app
infra/       AWS CDK app (TypeScript) — Cognito, API Gateway, Lambdas, DDB, Secrets
lambdas/     Lambda source (TypeScript)
```

The frontend reads its runtime config from `window.STRAVIFY_CONFIG` in `frontend/public/config.js`. None of those values are secrets — they're public identifiers (API Gateway URL, Cognito user pool + client ID).

## Prerequisites

1. AWS account + AWS CLI configured.
2. Node.js 20+.
3. CDK bootstrapped in your region: `npx cdk bootstrap aws://ACCOUNT_ID/REGION`.
4. A Strava API application — https://www.strava.com/settings/api. Default new apps are capped at 1 athlete; request a rate-limit increase if you want others to use it.
5. A Spotify dev app — https://developer.spotify.com/dashboard. (Optional, only needed if you want the Spotify fallback music source.)
6. A Last.fm API account — https://www.last.fm/api/account/create. Note the API key and shared secret.
7. Netlify CLI (`npm i -g netlify-cli`) and a Netlify account. (Optional — you can deploy via the Netlify dashboard if you prefer.)

## Initial setup

1. **Clone + install:**
   ```bash
   git clone <repo>
   cd Stravify
   (cd frontend && npm install)
   (cd lambdas && npm install)
   (cd infra && npm install)
   ```

2. **Deploy the backend** (creates the secret resources):
   ```bash
   cd infra
   npx cdk deploy
   ```
   Note the stack outputs: `ApiUrl`, `CognitoUserPoolId`, `CognitoClientId`, `StravaWebhookCallbackUrl`.

3. **Put OAuth credentials in Secrets Manager:**
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id stravify/strava \
     --secret-string '{"clientId":"...","clientSecret":"...","verifyToken":"pick-any-string"}'

   aws secretsmanager put-secret-value \
     --secret-id stravify/spotify \
     --secret-string '{"clientId":"...","clientSecret":"..."}'

   aws secretsmanager put-secret-value \
     --secret-id stravify/lastfm \
     --secret-string '{"apiKey":"...","sharedSecret":"..."}'
   ```

4. **Register the Strava webhook subscription** (one-time):
   ```bash
   curl -X POST https://www.strava.com/api/v3/push_subscriptions \
     -F client_id=YOUR_STRAVA_CLIENT_ID \
     -F client_secret=YOUR_STRAVA_CLIENT_SECRET \
     -F callback_url=https://YOUR_API_GATEWAY/webhooks/strava \
     -F verify_token=THE_SAME_STRING_YOU_PUT_IN_SECRETS
   ```

5. **Update third-party redirect URIs:**
   - Strava → "Authorization Callback Domain" = your API Gateway host (no scheme).
   - Spotify → add `https://YOUR_API_GATEWAY/auth/spotify/callback` to Redirect URIs.
   - Last.fm → add `https://YOUR_API_GATEWAY/auth/lastfm/callback` as the Callback URL.

6. **Update `frontend/public/config.js`** with the stack outputs:
   ```js
   window.STRAVIFY_CONFIG = {
     apiBaseUrl: "https://YOUR_API_GATEWAY",
     cognitoUserPoolId: "us-west-1_XXXXX",
     cognitoClientId: "XXXXX",
     appUrl: window.location.origin,
   };
   ```

7. **Deploy the frontend:**
   ```bash
   cd frontend
   npm run build
   netlify deploy --prod --dir=dist
   ```

   Or drag `frontend/dist/` into the Netlify dashboard.

## Local dev

```bash
cd frontend
npm run dev    # http://localhost:5173
```

The dev server uses the same deployed backend (your `config.js` already points at it). Make sure `http://localhost:5173` is in the `FRONTEND_URLS` array in `infra/lib/stravify-stack.ts` (it already is) so Cognito and CORS accept it.

Lambda changes are deployed with `cd infra && npx cdk deploy`. There's no `sam local` setup since the OAuth and webhook flows need real public URLs.

## API endpoints

JWT-authenticated routes (id token in `Authorization: Bearer <token>`):

| Method | Path | Purpose |
|--------|------|---------|
| GET    | `/api/me` | Current user profile + linked-service status |
| GET    | `/api/activities` | List your recent runs with music summary |
| GET    | `/api/activities/{id}` | Full activity record (owner-only) |
| GET    | `/api/me/top-songs` | Most-played tracks across your runs |
| POST   | `/api/sync` | Process recent unprocessed Strava runs. `?force=true` re-processes already-annotated ones |
| POST   | `/api/runs/{id}/publish` | Re-write the Strava description with the stravify.net link |
| GET    | `/auth/strava/start` | Returns Strava OAuth URL (carries `returnTo`) |
| GET    | `/auth/spotify/start` | Returns Spotify OAuth URL |
| GET    | `/auth/lastfm/start` | Returns Last.fm auth URL |

Public routes:

| Method | Path | Purpose |
|--------|------|---------|
| GET    | `/api/runs/{id}` | Public read of a single run (no auth — for `/run/:id` sharing) |
| GET    | `/auth/strava/callback` | Strava OAuth callback |
| GET    | `/auth/spotify/callback` | Spotify OAuth callback |
| GET    | `/auth/lastfm/callback` | Last.fm auth callback |
| GET    | `/webhooks/strava` | Strava subscription verification challenge |
| POST   | `/webhooks/strava` | Strava activity event |

## Data model

**Users** (PK `cognitoSub`)
- `email`, `createdAt`
- `stravaAthleteId`, `stravaAthleteName`, `stravaTokens` (access, refresh, expiresAt)
- `spotifyUserId`, `spotifyUserName`, `spotifyTokens`
- `lastfmUsername`, `lastfmSessionKey`
- GSI `byStravaAthleteId` — webhook uses this to look up the right user when a Strava event arrives.

**Activities** (PK `cognitoSub`, SK `activityId`)
- `name`, `startTime`, `elapsedSeconds`, `distanceMeters`, `type`
- `tracks: [{ trackId, trackName, artistNames, playedAt, imageUrl }]`
- `genreBreakdown: [{ genre, percent, trackCount }]`
- `musicSource: "lastfm" | "spotify"`, `processedAt`, `publishedAt`, `publishedUrl`
- GSI `byActivityId` — used by the public `/api/runs/{id}` endpoint.

**SongPlays** (PK `cognitoSub`, SK `trackId#playedAt`)
- `trackId`, `trackName`, `artistName`, `playedAt`, `activityId`, `source`

**OAuthState** (PK `state`, TTL `ttl`)
- `cognitoSub`, `service: "strava" | "spotify" | "lastfm"`, `returnTo`

## Brand compliance

Stravify uses the official "Powered by Strava" logo (`frontend/public/powered-by-strava.svg`) in the landing and run-detail footers, plus a "View on Strava" link in `#FC5200` on the run-detail page. The app is not affiliated with, endorsed by, or sponsored by Strava — that's stated in the landing footer. See https://developers.strava.com/guidelines/.

## License

MIT.
