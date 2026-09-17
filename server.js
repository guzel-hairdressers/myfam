/**
 * MyFam - Ultra-lightweight Censorship-Resistant Video/Voice Calling Server
 * 
 * 100% EPHEMERAL & RELIABLE:
 * - NO database, zero persistent storage.
 * - Multi-STUN fallback (Google, Cloudflare, Mozilla, Metered).
 * - Immediate in-memory cleanup when rooms empty.
 * - Memory footprint < 30MB RAM.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
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

// Static file server
const server = http.createServer((req, res) => {
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

    // Never cache static scripts or HTML during active use
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

// Ephemeral room management
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

    // Join room with code
    if (type === 'join') {
      const { code, name } = payload || {};
      const cleanCode = (code || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

      if (!cleanCode || cleanCode.length < 4) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Enter a valid call code.' } }));
        return;
      }

      let room = rooms.get(cleanCode);

      if (!room) {
        room = { peers: new Map() };
        rooms.set(cleanCode, room);
      }

      if (room.peers.size >= 8) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Call room is full (max 8 members).' } }));
        return;
      }

      ws.roomCode = cleanCode;
      ws.name = name ? name.trim().slice(0, 24) : 'Family Member';

      // Collect existing peers
      const existingPeers = [];
      for (const [peerId, peer] of room.peers.entries()) {
        existingPeers.push({ id: peerId, name: peer.name });
      }

      // Add self to room
      room.peers.set(ws.id, { ws, name: ws.name });

      console.log(`[Room ${cleanCode}] ${ws.name} (${ws.id}) joined. Total peers: ${room.peers.size}`);

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
  console.log(`[Room ${ws.roomCode}] Peer ${ws.id} left. Remaining: ${room.peers.size}`);

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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`  MyFam Ephemeral Call Server Running`);
  console.log(`  Port: http://0.0.0.0:${PORT}`);
  console.log(`  ICE Servers: ${DEFAULT_ICE_SERVERS.length} available`);
  console.log(`====================================================`);
});
