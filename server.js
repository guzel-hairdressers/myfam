/**
 * MyFam - Ultra-lightweight Censorship-Resistant Video/Voice Calling Server
 * 
 * 100% EPHEMERAL:
 * - NO database (no SQLite, Postgres, Redis, or disk storage).
 * - NO user accounts, no registration, no passwords saved.
 * - NO IP address logging or call metadata tracking.
 * - All rooms and connections exist strictly in volatile RAM while calls are active.
 * - Memory footprint < 30MB RAM.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');

// Custom STUN/TURN servers via environment variables (e.g. your Coturn server)
const CUSTOM_TURN_URL = process.env.TURN_URL || '';
const CUSTOM_TURN_USERNAME = process.env.TURN_USERNAME || '';
const CUSTOM_TURN_CREDENTIAL = process.env.TURN_CREDENTIAL || '';

// High-reliability STUN servers unblocked in China/Russia (unlike Google's)
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.services.mozilla.com:3478' },
  { urls: 'stun:stun.nextcloud.com:443' },
  { urls: 'stun:stun.syncthing.net:3478' }
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

// Static file server
const server = http.createServer((req, res) => {
  // Strict privacy headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  // Cloud host healthcheck
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', activeRooms: rooms.size }));
  }

  // ICE config endpoint
  if (req.url === '/api/ice-config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ iceServers: DEFAULT_ICE_SERVERS }));
  }

  // Sanitize static path
  let safeUrl = req.url.split('?')[0];
  if (safeUrl === '/' || safeUrl === '') {
    safeUrl = '/index.html';
  }

  const filePath = path.join(PUBLIC_DIR, path.normalize(safeUrl));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(indexPath, (indexErr, content) => {
        if (indexErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('404 Not Found');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    if (ext === '.html') {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

// Ephemeral in-memory room management (Wiped clean when empty)
// code -> { hash: string, peers: Map<clientId, { ws, name }> }
const rooms = new Map();
const wss = new WebSocketServer({ server });

function generateClientId() {
  return Math.random().toString(36).substring(2, 9);
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
      if (!ws.roomCode) return;
      const room = rooms.get(ws.roomCode);
      if (!room) return;

      for (const [peerId, peer] of room.peers.entries()) {
        if (peerId !== ws.id && peer.ws.readyState === WebSocket.OPEN) {
          peer.ws.send(data, { binary: true });
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

    const { type, payload } = message;

    // Latency RTT measurement
    if (type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', payload: { clientTime: payload?.clientTime } }));
      return;
    }

    // Join room with code & cryptographic hash check
    if (type === 'join') {
      const { code, name, clientHash } = payload || {};
      const cleanCode = (code || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

      if (!cleanCode || cleanCode.length < 4) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Enter a valid call code (at least 4 characters/digits).' } }));
        return;
      }

      let room = rooms.get(cleanCode);

      if (!room) {
        // First peer creates the ephemeral room
        room = {
          hash: clientHash || '',
          peers: new Map()
        };
        rooms.set(cleanCode, room);
      } else {
        // Second peer checks hash match if hash verification is present
        if (room.hash && clientHash && room.hash !== clientHash) {
          ws.send(JSON.stringify({ type: 'error', payload: { message: 'Security hash mismatch for this code.' } }));
          return;
        }

        // Limit to 4 family members per room for bandwidth stability
        if (room.peers.size >= 4) {
          ws.send(JSON.stringify({ type: 'error', payload: { message: 'Call room is full (max 4 members).' } }));
          return;
        }
      }

      ws.roomCode = cleanCode;
      ws.name = name ? name.trim().slice(0, 24) : 'Family Member';

      // Existing peers in room
      const existingPeers = [];
      for (const [peerId, peer] of room.peers.entries()) {
        existingPeers.push({ id: peerId, name: peer.name });
      }

      room.peers.set(ws.id, { ws, name: ws.name });

      // Confirm join
      ws.send(JSON.stringify({
        type: 'joined',
        payload: {
          clientId: ws.id,
          code: cleanCode,
          peers: existingPeers,
          iceServers: DEFAULT_ICE_SERVERS
        }
      }));

      // Announce new peer
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

    // Direct WebRTC signaling exchange (offer, answer, candidate, stealth-toggle)
    if (['offer', 'answer', 'candidate', 'stealth-toggle'].includes(type)) {
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
  if (!room) return;

  room.peers.delete(ws.id);

  // Broadcast peer left
  for (const [peerId, peer] of room.peers.entries()) {
    if (peer.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(JSON.stringify({
        type: 'peer-left',
        payload: { id: ws.id, name: ws.name }
      }));
    }
  }

  // WIPE ROOM COMPLETELY FROM RAM WHEN EMPTY
  if (room.peers.size === 0) {
    rooms.delete(ws.roomCode);
  }

  ws.roomCode = null;
}

// 25-second heartbeat keeps connection open through strict NAT & firewalls
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);

wss.on('close', () => clearInterval(interval));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`  MyFam Ephemeral Call Server Running`);
  console.log(`  Port: http://0.0.0.0:${PORT}`);
  console.log(`  Privacy: 100% in-memory (No database, no logs)`);
  console.log(`  ICE Servers: ${DEFAULT_ICE_SERVERS.length} available`);
  console.log(`====================================================`);
});
