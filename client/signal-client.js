// Minimal client for the Screen Stocks Signal API (Node 18+, no dependencies).
//
// const { connect } = require('./signal-client');
// connect({
//   url: 'https://your-app.onrender.com',
//   code: 'JOINCODE',                  // optional
//   onSignal: (s) => { ... },          // called immediately when a signal is announced
//   onFire:   (s) => { ... },          // called at the exact synchronized moment
// });
//
// The signal object: { id, action: 'buy'|'sell', note, secondsUntil, fireAt }

async function connect({ url, code = '', onSignal = () => {}, onFire = () => {}, onStatus = () => {} }) {
  let offset = 0; // serverTime - localTime

  const handle = (event, data) => {
    if (event === 'hello') {
      offset = data.serverTime - Date.now();
      onStatus(`connected (${data.listeners} listener(s))`);
    } else if (event === 'signal') {
      offset = data.serverTime - Date.now();
      const msLeft = () => data.fireAt - (Date.now() + offset);
      const sig = { ...data, secondsUntil: Math.round(msLeft() / 1000) };
      onSignal(sig);
      setTimeout(() => onFire({ ...sig, secondsUntil: 0 }), Math.max(0, msLeft()));
    }
  };

  for (;;) { // auto-reconnect loop
    try {
      const res = await fetch(`${url}/events?code=${encodeURIComponent(code)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const decoder = new TextDecoder();
      let buf = '';
      for await (const chunk of res.body) {
        buf += decoder.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block);
          const dt = /^data: (.+)$/m.exec(block);
          if (ev && dt) handle(ev[1], JSON.parse(dt[1]));
        }
      }
    } catch (e) {
      onStatus(`connection problem: ${e.message}, retrying in 3s`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

module.exports = { connect };

// Run directly: node signal-client.js https://your-app.onrender.com [joincode]
if (require.main === module) {
  const [url, code] = process.argv.slice(2);
  if (!url) { console.log('Usage: node signal-client.js <url> [joincode]'); process.exit(1); }
  connect({
    url, code,
    onStatus: (m) => console.log('[status]', m),
    onSignal: (s) => console.log(`\n[signal] ${s.action.toUpperCase()} in ${s.secondsUntil}s ${s.note || ''}`),
    onFire: (s) => { process.stdout.write('\x07'); console.log(`>>> ${s.action.toUpperCase()} NOW <<<`); },
  });
}
