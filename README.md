# Screen Stocks Signal API

Sends BUY/SELL signals with a synchronized countdown. It does NOT touch the game; players act manually.

## Deploy on Render (free)
1. Push this folder to a GitHub repo.
2. Render dashboard -> New -> Blueprint (uses render.yaml), or New -> Web Service (build: `npm install`, start: `npm start`).
3. Set env vars: `ADMIN_KEY` (secret, host only) and optionally `JOIN_CODE` (invite-only).
4. Open your `https://<name>.onrender.com` link. Players click Connect; the host uses the Host panel.

## Endpoints
- GET  /events?code=...  live stream (SSE)
- POST /signal           header `x-admin-key`, body `{action:"buy"|"sell", delaySeconds, note}`
- GET  /status, GET /time

Note: the Render free tier sleeps after ~15 min idle, so the first load can take ~30-60 s. Open the page a minute before you start.
