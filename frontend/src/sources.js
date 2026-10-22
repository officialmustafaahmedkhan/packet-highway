// Data sources: live WebSocket stream + PCAP upload/sample fetch.

export class LiveSource {
  /** handlers: { onHello(info), onPackets(items, dropped), onError(msg), onClose() } */
  constructor(handlers) {
    this.h = handlers;
    this.ws = null;
    this.params = null;      // last start() args, reused for reconnects
    this.retry = 0;          // consecutive failed attempts
    this.retrying = false;   // a reconnect is already scheduled
    this.retryTimer = null;
  }

  start({ iface, bpf, demo }) {
    this.params = { iface, bpf, demo };
    this.retry = 0;
    this.retrying = false;
    this._connect();
  }

  _connect() {
    const { iface, bpf, demo } = this.params;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const params = new URLSearchParams();
    if (demo) params.set('demo', '1');
    if (iface) params.set('iface', iface);
    if (bpf) params.set('bpf', bpf);
    const ws = new WebSocket(`${proto}://${location.host}/ws/live?${params}`);
    this.ws = ws;
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'packets') this.h.onPackets(msg.items, msg.dropped ?? 0);
      else if (msg.type === 'hello') {
        this.retry = 0;
        this.retrying = false;
        this.h.onHello(msg);
      }
      else if (msg.type === 'error') this.h.onError(msg.message);
    };
    ws.onerror = () => {
      // Don't stack a toast on every retry attempt — the reconnect handles it.
      if (this.retrying) return;
      this.h.onError('WebSocket error — is the backend still running?');
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.h.onClose();
      // Serverless platforms cap how long a single WebSocket may stay open
      // (Vercel: maxDuration). Reconnect so the stream survives the cut
      // instead of going silently dead.
      if (this.params) this._scheduleReconnect();
    };
  }

  _scheduleReconnect() {
    if (this.retryTimer) return;
    this.retrying = true;
    const delay = Math.min(1000 * 2 ** this.retry, 15000);
    this.retry += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.params) this._connect();
    }, delay);
  }

  stop() {
    const ws = this.ws;
    this.params = null;
    this.retrying = false;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    // detach ALL handlers: queued messages must not spawn vehicles after STOP,
    // and closing a still-CONNECTING socket fires a spurious error event
    if (ws) {
      ws.onmessage = ws.onerror = ws.onclose = null;
      ws.close();
    }
    this.ws = null;
    this.h.onClose();
  }

  get running() { return !!this.ws && this.ws.readyState <= WebSocket.OPEN; }
}

// The platform proxy can reject a request before it reaches the app (e.g. an
// oversized upload on Vercel), returning HTML instead of our JSON error shape.
async function readJson(r) {
  const text = await r.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { error: text.slice(0, 200) }; }
}

export async function fetchInterfaces() {
  const r = await fetch('/api/interfaces');
  if (!r.ok) return [];
  const body = await readJson(r);
  return Array.isArray(body) ? body : [];
}

export async function uploadPcap(file) {
  const form = new FormData();
  form.append('file', file);
  const r = await fetch('/api/pcap', { method: 'POST', body: form });
  const body = await readJson(r);
  if (!r.ok) throw new Error(body?.error ?? `Upload failed (${r.status})`);
  return body;
}

export async function fetchSample() {
  const r = await fetch('/api/sample');
  const body = await readJson(r);
  if (!r.ok) throw new Error(body?.error ?? `Sample failed (${r.status})`);
  return body;
}
