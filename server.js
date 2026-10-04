const express = require('express')
const crypto = require('crypto')

const app = express()
app.use(express.json())
app.use(express.static('public'))

const KEY = process.env.ADMIN_KEY
const CODE = process.env.JOIN_CODE || ''
const port = process.env.PORT || 3000

let listeners = []
let last = null

app.get('/time', (req, res) => res.json({ serverTime: Date.now() }))

app.get('/events', (req, res) => {
  if (CODE && req.query.code !== CODE) return res.status(401).json({ error: 'wrong code' })

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  })
  res.flushHeaders()
  res.write('event: hello\ndata: ' + JSON.stringify({ serverTime: Date.now(), last, listeners: listeners.length + 1 }) + '\n\n')

  listeners.push(res)
  req.on('close', () => {
    listeners = listeners.filter(l => l !== res)
  })
})

app.post('/signal', (req, res) => {
  if (!KEY || req.get('x-admin-key') !== KEY) return res.status(401).json({ error: 'nope' })

  const { action, delaySeconds, note, stockId } = req.body || {}
  if (action !== 'buy' && action !== 'sell') {
    return res.status(400).json({ error: 'action must be buy or sell' })
  }

  let delay = Number(delaySeconds) || 10
  delay = Math.max(3, Math.min(120, delay))

  const now = Date.now()
  last = {
    id: crypto.randomUUID(),
    action,
    stockId: stockId == null ? null : String(stockId).slice(0, 64),
    note: String(note || '').slice(0, 140),
    createdAt: now,
    fireAt: now + delay * 1000
  }

  const msg = 'event: signal\ndata: ' + JSON.stringify({ ...last, serverTime: now }) + '\n\n'
  listeners.forEach(l => l.write(msg))

  res.json({ ok: true, signal: last, listeners: listeners.length })
})

// plain endpoint, no stream. returns the last signal
app.get('/latest', (req, res) => {
  if (CODE && req.query.code !== CODE) return res.status(401).json({ error: 'wrong code' })
  if (!last) return res.json({ signal: null, serverTime: Date.now() })
  res.json({
    id: last.id,
    action: last.action,
    stockId: last.stockId,
    timestamp: last.fireAt,
    serverTime: Date.now()
  })
})

app.get('/status', (req, res) => res.json({ listeners: listeners.length, last }))

// render kills idle connections so keep them busy
setInterval(() => listeners.forEach(l => l.write(': ping\n\n')), 20000)

app.listen(port, () => console.log('running on ' + port))
