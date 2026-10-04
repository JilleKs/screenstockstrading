const express = require('express')
const crypto = require('crypto')
const { Pool } = require('pg')

const app = express()
app.use(express.json())
app.use(express.static('public'))

const ADMIN_KEY = process.env.ADMIN_KEY
const HOST_ONLY = process.env.HOST_ONLY !== 'false' // set HOST_ONLY=false so everyone can make events
const port = process.env.PORT || 3000

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

async function setup() {
  await db.query(`
    create table if not exists users (
      id uuid primary key default gen_random_uuid(),
      token text unique not null,
      name text,
      created_at timestamptz default now()
    );
    create table if not exists events (
      id uuid primary key default gen_random_uuid(),
      stock_id text not null,
      action text not null check (action in ('buy','sell')),
      fire_at timestamptz not null,
      note text default '',
      created_by uuid references users(id),
      created_at timestamptz default now()
    );
    create table if not exists subscriptions (
      event_id uuid references events(id) on delete cascade,
      user_id uuid references users(id) on delete cascade,
      primary key (event_id, user_id)
    );
  `)
}

function isAdmin(req) {
  return ADMIN_KEY && req.get('x-admin-key') === ADMIN_KEY
}

async function getUser(req) {
  const h = req.get('authorization') || ''
  if (!h.startsWith('Bearer ')) return null
  const r = await db.query('select * from users where token = $1', [h.slice(7)])
  return r.rows[0] || null
}

function fmt(row) {
  return {
    id: row.id,
    stockId: row.stock_id,
    action: row.action,
    timestamp: new Date(row.fire_at).getTime(),
    note: row.note,
    subscribers: Number(row.subscribers || 0),
    subscribed: !!row.subscribed
  }
}

const wrap = fn => (req, res) => fn(req, res).catch(e => {
  console.error(e)
  res.status(500).json({ error: 'server error' })
})

// get a token, keep it, send it as "Authorization: Bearer <token>"
app.post('/register', wrap(async (req, res) => {
  const token = crypto.randomBytes(24).toString('hex')
  const name = String((req.body && req.body.name) || '').slice(0, 40)
  await db.query('insert into users (token, name) values ($1, $2)', [token, name])
  res.json({ token })
}))

// list of upcoming events
app.get('/events', wrap(async (req, res) => {
  const user = await getUser(req)
  const r = await db.query(`
    select e.*,
      (select count(*) from subscriptions s where s.event_id = e.id) as subscribers,
      exists (select 1 from subscriptions s where s.event_id = e.id and s.user_id = $1) as subscribed
    from events e
    where e.fire_at > now() - interval '1 minute'
    order by e.fire_at`, [user ? user.id : null])
  res.json({ serverTime: Date.now(), events: r.rows.map(fmt) })
}))

// make an event
app.post('/events', wrap(async (req, res) => {
  const user = await getUser(req)
  const admin = isAdmin(req)
  if (!admin && !(user && !HOST_ONLY)) return res.status(401).json({ error: 'not allowed' })

  const { stockId, action, delaySeconds, timestamp, note } = req.body || {}
  if (!stockId) return res.status(400).json({ error: 'stockId needed' })
  if (action !== 'buy' && action !== 'sell') return res.status(400).json({ error: 'action must be buy or sell' })

  let fireAt = Number(timestamp)
  if (!fireAt) fireAt = Date.now() + Math.max(3, Number(delaySeconds) || 10) * 1000
  if (fireAt < Date.now()) return res.status(400).json({ error: 'timestamp is in the past' })

  const r = await db.query(
    'insert into events (stock_id, action, fire_at, note, created_by) values ($1,$2,$3,$4,$5) returning *',
    [String(stockId).slice(0, 64), action, new Date(fireAt), String(note || '').slice(0, 140), user ? user.id : null]
  )
  const ev = fmt(r.rows[0])
  const msg = 'event: event\ndata: ' + JSON.stringify({ ...ev, serverTime: Date.now() }) + '\n\n'
  listeners.forEach(l => l.write(msg))
  res.status(201).json(ev)
}))

app.post('/events/:id/subscribe', wrap(async (req, res) => {
  const user = await getUser(req)
  if (!user) return res.status(401).json({ error: 'register first' })
  try {
    await db.query('insert into subscriptions (event_id, user_id) values ($1,$2) on conflict do nothing', [req.params.id, user.id])
  } catch (e) {
    return res.status(404).json({ error: 'no such event' })
  }
  res.json({ ok: true })
}))

app.delete('/events/:id/subscribe', wrap(async (req, res) => {
  const user = await getUser(req)
  if (!user) return res.status(401).json({ error: 'register first' })
  await db.query('delete from subscriptions where event_id = $1 and user_id = $2', [req.params.id, user.id])
  res.json({ ok: true })
}))

// only the events you are subscribed to
app.get('/me/events', wrap(async (req, res) => {
  const user = await getUser(req)
  if (!user) return res.status(401).json({ error: 'register first' })
  const r = await db.query(`
    select e.*,
      (select count(*) from subscriptions s2 where s2.event_id = e.id) as subscribers,
      true as subscribed
    from events e join subscriptions s on s.event_id = e.id
    where s.user_id = $1 and e.fire_at > now() - interval '1 minute'
    order by e.fire_at`, [user.id])
  res.json({ serverTime: Date.now(), events: r.rows.map(fmt) })
}))

// live stream of new events
let listeners = []
app.get('/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  res.flushHeaders()
  res.write('event: hello\ndata: ' + JSON.stringify({ serverTime: Date.now() }) + '\n\n')
  listeners.push(res)
  req.on('close', () => { listeners = listeners.filter(l => l !== res) })
})
setInterval(() => listeners.forEach(l => l.write(': ping\n\n')), 20000)

app.get('/time', (req, res) => res.json({ serverTime: Date.now() }))
app.get('/status', (req, res) => res.json({ ok: true, listeners: listeners.length }))

setup()
  .then(() => app.listen(port, () => console.log('running on ' + port)))
  .catch(e => { console.error('db setup failed', e.message); process.exit(1) })
