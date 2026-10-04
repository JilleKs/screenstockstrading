const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const ADMIN_KEY = process.env.ADMIN_KEY;      // required: only the host can send signals
const JOIN_CODE = process.env.JOIN_CODE || ''; // optional: makes the room invite-only
const PORT = process.env.PORT || 3000;

const clients = new Set();
let lastSignal = null;

const joinOk = (req) => !JOIN_CODE || req.query.code === JOIN_CODE;

// Server clock, so clients can correct for their own clock offset
app.get('/time', (req, res) => res.json({ serverTime: Date.now() }));

// Live stream of signals (Server-Sent Events)
app.get('/events', (req, res) => {
  if (!joinOk(req)) return res.status(401).json({ error: 'Invalid join code' });
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  res.write(`event: hello\ndata: ${JSON.stringify({ serverTime: Date.now(), last: lastSignal, listeners: clients.size + 1 })}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

// Host sends a signal: { "action": "buy" | "sell", "delaySeconds": 10, "note": "optional" }
app.post('/signal', (req, res) => {
  if (!ADMIN_KEY || req.get('x-admin-key') !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { action, delaySeconds, note } = req.body || {};
  if (!['buy', 'sell'].includes(action)) {
    return res.status(400).json({ error: 'action must be "buy" or "sell"' });
  }
  const delay = Math.min(120, Math.max(3, Number(delaySeconds) || 10));
  const now = Date.now();
  lastSignal = {
    id: crypto.randomUUID(),
    action,
    note: String(note || '').slice(0, 140),
    createdAt: now,
    fireAt: now + delay * 1000,
  };
  const payload = `event: signal\ndata: ${JSON.stringify({ ...lastSignal, serverTime: now })}\n\n`;
  clients.forEach((c) => c.write(payload));
  res.json({ ok: true, signal: lastSignal, listeners: clients.size });
});

app.get('/status', (req, res) => res.json({ listeners: clients.size, last: lastSignal }));

// Keep connections alive (Render closes idle streams)
setInterval(() => clients.forEach((c) => c.write(': ping\n\n')), 20000);

app.listen(PORT, () => console.log(`Signal API running on port ${PORT}`));
