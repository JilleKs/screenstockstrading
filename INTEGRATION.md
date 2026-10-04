# api

https://screenstockstrading.onrender.com

## get a token (once)

```
POST /register
-> {"token":"..."}
```

send it on every request: `Authorization: Bearer <token>`

## events

```
GET /events          all upcoming events
GET /me/events       only the ones you joined
```

```json
{
  "serverTime": 1760000000000,
  "events": [
    {
      "id": "b1f0c6e2-...",
      "stockId": "123",
      "action": "buy",
      "timestamp": 1760000010000,
      "note": "",
      "subscribers": 4,
      "subscribed": true
    }
  ]
}
```

- `timestamp` = when it happens (ms, server time)
- `serverTime` = server clock now, time left = `timestamp - serverTime`
- `id` is unique per event

## join / leave

```
POST   /events/:id/subscribe
DELETE /events/:id/subscribe
```

only events you joined show up in `/me/events`. if you never join, nothing happens for you.

## live (optional)

`GET /stream` pushes new events the moment they are made (SSE).

## make an event (host)

```bash
curl -X POST https://screenstockstrading.onrender.com/events \
  -H "Content-Type: application/json" \
  -H "x-admin-key: YOUR_ADMIN_KEY" \
  -d '{"stockId":"123","action":"buy","delaySeconds":30}'
```

or give `"timestamp"` (ms) instead of `delaySeconds`. free host sleeps when idle, first request can take a minute.
