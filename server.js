/**
 * MyFam - Ultra-lightweight Censorship-Resistant Video/Voice Calling Server
 * 
 * 100% EPHEMERAL & RELIABLE:
 * - NO database, zero persistent storage.
 * - Multi-STUN fallback (Google, Cloudflare, Mozilla, Metered).
 * - Immediate in-memory cleanup when rooms empty.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');

// Custom STUN/TURN servers via environment variables
const CUSTOM_TURN_URL = process.env.TURN_URL || '';
const CUSTOM_TURN_USERNAME = process.env.TURN_USERNAME || '';
const CUSTOM_TURN_CREDENTIAL = process.env.TURN_CREDENTIAL || '';

// High-reliability STUN servers for global connectivity (China, Russia, EU, US)
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.services.mozilla.com:3478' },
  { urls: 'stun:stun.nextcloud.com:443' },
  { urls: 'stun:stun.relay.metered.ca:80' }
];

if (CUSTOM_TURN_URL) {
  DEFAULT_ICE_SERVERS.push({
    urls: CUSTOM_TURN_URL,
    username: CUSTOM_TURN_USERNAME,
    credential: CUSTOM_TURN_CREDENTIAL
  });
}

// MIME types map
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

function createApp() {
// Static file server
const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  res.setHeader('Cache-Control', 'no-store');
  let pathname;
  try {
    pathname = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400);
    return res.end('Bad request');
  }
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end('Method not allowed');
  }

  // Cloud host healthcheck
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', activeRooms: rooms.size }));
  }

  // ICE config endpoint
  if (pathname === '/api/ice-config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ iceServers: DEFAULT_ICE_SERVERS }));
  }

  const filePath = path.resolve(PUBLIC_DIR, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404 Not Found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Never cache static scripts or HTML during active use
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.writeHead(200, { 'Content-Type': contentType });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
});

// Ephemeral room management
const rooms = new Map();
const wss = new WebSocketServer({ server, maxPayload: 256 * 1024, perMessageDeflate: false });

function generateClientId() {
  return randomUUID();
}

wss.on('connection', (ws) => {
  ws.id = generateClientId();
  ws.roomCode = null;
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (data, isBinary) => {
    // Binary streaming for Stealth WebSocket fallback
    if (isBinary) {
      if (!ws.roomCode || data.length < 2 || ![1, 2].includes(data[0])) return;
      const room = rooms.get(ws.roomCode);
      if (!room) return;

      for (const [peerId, peer] of room.peers.entries()) {
        if (peerId !== ws.id && peer.ws.readyState === WebSocket.OPEN) {
          if (peer.ws.bufferedAmount < 64 * 1024) peer.ws.send(data, { binary: true });
        }
      }
      return;
    }

    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (e) {
      return;
    }

    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    const { type, payload } = message;
    if (payload !== undefined && (!payload || typeof payload !== 'object' || Array.isArray(payload))) return;

    // Latency RTT measurement
    if (type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', payload: { clientTime: payload?.clientTime } }));
      return;
    }

    // Lightweight presence lookup for caller's saved groups / typed code
    if (type === 'check-rooms') {
      const codes = Array.isArray(payload?.codes) ? payload.codes.slice(0, 20) : [];
      const result = {};
      for (const raw of codes) {
        const clean = typeof raw === 'string' ? raw.replace(/-/g, '').toLowerCase() : '';
        if (!/^[a-z0-9]{6}$/.test(clean)) continue;
        const room = rooms.get(clean);
        result[clean] = room
          ? Array.from(room.peers.values()).map((p) => ({ name: p.name }))
          : [];
      }
      ws.send(JSON.stringify({ type: 'rooms-status', payload: { rooms: result } }));
      return;
    }

    // Join room with code
    if (type === 'join') {
      const { code, name } = payload || {};
      const cleanCode = typeof code === 'string' ? code.replace(/-/g, '').toLowerCase() : '';
      if (typeof name !== 'undefined' && typeof name !== 'string') return;

      if (!/^[a-z0-9]{6}$/.test(cleanCode)) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Enter a valid call code.' } }));
        return;
      }

      if (ws.roomCode === cleanCode) return;
      const now = Date.now();
      if (!ws.joinWindow || now - ws.joinWindow > 60000) { ws.joinWindow = now; ws.joinAttempts = 0; }
      if (++ws.joinAttempts > 30) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Too many join attempts. Try again in a minute.' } }));
        return;
      }
      let room = rooms.get(cleanCode);

      if (!room) {
        room = { peers: new Map() };
        rooms.set(cleanCode, room);
      }

      if (room.peers.size >= 5) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Call room is full (max 5 family members).' } }));
        return;
      }

      leaveRoom(ws);
      ws.roomCode = cleanCode;
      ws.name = name ? name.trim().slice(0, 24) : 'Family Member';

      // Collect existing peers
      const existingPeers = [];
      for (const [peerId, peer] of room.peers.entries()) {
        existingPeers.push({ id: peerId, name: peer.name });
      }

      // Add self to room
      room.peers.set(ws.id, { ws, name: ws.name });



      // Confirm join to self
      ws.send(JSON.stringify({
        type: 'joined',
        payload: {
          clientId: ws.id,
          code: cleanCode,
          peers: existingPeers,
          iceServers: DEFAULT_ICE_SERVERS
        }
      }));

      // Announce new peer to existing peers
      for (const [peerId, peer] of room.peers.entries()) {
        if (peerId !== ws.id && peer.ws.readyState === WebSocket.OPEN) {
          peer.ws.send(JSON.stringify({
            type: 'peer-joined',
            payload: { id: ws.id, name: ws.name }
          }));
        }
      }
      return;
    }

    // Ephemeral in-call chat broadcast (zero persistence)
    if (type === 'chat') {
      if (!ws.roomCode) return;
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      const text = typeof payload?.text === 'string' ? payload.text.trim().slice(0, 1000) : '';
      if (!text) return;
      const sender = room.peers.get(ws.id);
      const out = JSON.stringify({
        type: 'chat',
        payload: {
          senderId: ws.id,
          senderName: sender ? sender.name : 'Family Member',
          text,
          ts: Date.now()
        }
      });
      for (const [peerId, peer] of room.peers.entries()) {
        if (peerId !== ws.id && peer.ws.readyState === WebSocket.OPEN) {
          peer.ws.send(out);
        }
      }
      return;
    }

    // Direct WebRTC signaling exchange (offer, answer, candidate, stealth-toggle, camera-toggle)
    if (['offer', 'answer', 'candidate', 'stealth-toggle', 'camera-toggle'].includes(type)) {
      const { targetId } = payload || {};
      if (!ws.roomCode || !targetId) return;

      const room = rooms.get(ws.roomCode);
      if (!room) return;

      const target = room.peers.get(targetId);
      if (target && target.ws.readyState === WebSocket.OPEN) {
        target.ws.send(JSON.stringify({
          type,
          payload: {
            ...payload,
            senderId: ws.id,
            senderName: ws.name
          }
        }));
      }
      return;
    }

    // Leave
    if (type === 'leave') {
      leaveRoom(ws);
    }
  });

  ws.on('close', () => leaveRoom(ws));
  ws.on('error', () => leaveRoom(ws));
});

function leaveRoom(ws) {
  if (!ws.roomCode) return;
  const room = rooms.get(ws.roomCode);
  if (!room) { ws.roomCode = null; return; }

  room.peers.delete(ws.id);


  for (const [peerId, peer] of room.peers.entries()) {
    if (peer.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(JSON.stringify({
        type: 'peer-left',
        payload: { id: ws.id, name: ws.name }
      }));
    }
  }

  if (room.peers.size === 0) {
    rooms.delete(ws.roomCode);
  }

  ws.roomCode = null;
}

// 25-second heartbeat keeps connection open through NAT & firewalls
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);

wss.on('close', () => clearInterval(interval));

return { server, wss, rooms };
}

if (require.main === module) {
  const { server } = createApp();
  server.listen(PORT, process.env.HOST || '0.0.0.0', () => {
    console.log(`MyFam listening on port ${server.address().port}`);
  });
}

module.exports = { createApp };
