/**
 * MyFam - Ultra-lightweight Censorship-Resistant Voice & Video Client
 * 
 * 100% EPHEMERAL & PRIVATE:
 * - No user registration, no server accounts, no profiles.
 * - Simple 6-digit call codes (e.g. 742-918).
 * - Robust WebRTC with ICE candidate queuing (prevents "Connecting..." hang).
 * - Multi-STUN fallback (Google, Cloudflare, Mozilla, Metered).
 * - 6-second auto-fallback to Stealth WebSocket Tunnel on TLS port 443.
 * - Local-only family contacts (saved on your phone/browser only).
 */

(() => {
  // Quality & Bandwidth Presets
  const PRESETS = {
    potato: {
      label: 'Ultra-Low (Potato)',
      width: { ideal: 160 },
      height: { ideal: 120 },
      frameRate: 10,
      videoBitrate: 45000,
      audioBitrate: 16000,
      stealthFps: 5,
      stealthQuality: 0.3
    },
    low: {
      label: 'Low Bandwidth',
      width: { ideal: 320 },
      height: { ideal: 240 },
      frameRate: 15,
      videoBitrate: 120000,
      audioBitrate: 20000,
      stealthFps: 8,
      stealthQuality: 0.4
    },
    balanced: {
      label: 'Balanced',
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: 20,
      videoBitrate: 350000,
      audioBitrate: 24000,
      stealthFps: 12,
      stealthQuality: 0.55
    },
    hd: {
      label: 'High Definition',
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: 30,
      videoBitrate: 750000,
      audioBitrate: 32000,
      stealthFps: 15,
      stealthQuality: 0.7
    }
  };

  const QUALITY_TIERS = ['potato', 'low', 'balanced', 'hd'];

  function getEffectivePreset() {
    if (state.currentPreset === 'auto') {
      return PRESETS[state.activeTier] || PRESETS.low;
    }
    return PRESETS[state.currentPreset] || PRESETS.low;
  }

  // State
  const state = {
    ws: null,
    clientId: null,
    activeCode: null,
    userName: '',
    currentPreset: 'auto',
    activeTier: 'low',
    goodNetworkCycles: 0,
    forceStealth: false,
    facingMode: 'user',
    
    localStream: null,
    peers: new Map(), // peerId -> { id, name, pc, stream, pendingCandidates, iceTimeoutTimer, hasVideo, tileEl, videoEl, avatarEl, initialsEl, nameEl, waveEl }
    iceServers: [],
    
    isAudioMuted: false,
    isVideoOff: false,
    isScreenSharing: false,
    
    // Stealth fallback mode state
    isStealthActive: false,
    stealthAudioSource: null,
    stealthAudioNode: null,
    audioContext: null,
    audioModule: null,
    nextAudioTime: 0,
    reconnectTimer: null,
    joinTimer: null,
    joining: false,
    callGeneration: 0,
    visualizers: new Map(),
    stealthVideoTimer: null,
    stealthAudioContext: null,
    
    // Diagnostics
    lastBytesReceived: 0,
    lastStatsTime: 0,
    lastPacketsLost: 0,
    lastPacketsTotal: 0,
    pingInterval: null,
    statsInterval: null,
    currentPing: null
  };

  const storage = {
    getItem(key) { try { return localStorage.getItem(key); } catch { return null; } },
    setItem(key, value) { try { localStorage.setItem(key, value); } catch { showToast('Browser storage unavailable. Changes will not be saved.'); } }
  };

  // DOM Elements holder
  const els = {};

  function initElements() {
    els.serverStatusBadge = document.getElementById('serverStatusBadge');
    els.serverStatusText = document.getElementById('serverStatusText');
    els.lobbyView = document.getElementById('lobbyView');
    els.callView = document.getElementById('callView');
    els.joinForm = document.getElementById('joinForm');
    els.codeInput = document.getElementById('codeInput');
    els.lobbyCopyBtn = document.getElementById('lobbyCopyBtn');
    els.newCodeBtn = document.getElementById('newCodeBtn');
    els.nameInput = document.getElementById('nameInput');
    els.rememberNameCheckbox = document.getElementById('rememberNameCheckbox');
    els.presetSelect = document.getElementById('presetSelect');
    els.forceStealthCheckbox = document.getElementById('forceStealthModeCheckbox');
    els.joinBtn = document.getElementById('joinBtn');
    els.joinError = document.getElementById('joinError');
    els.contactsList = document.getElementById('contactsList');
    els.addContactBtn = document.getElementById('addContactBtn');
    els.contactModal = document.getElementById('contactModal');
    els.contactModalTitle = document.getElementById('contactModalTitle');
    els.contactNameInput = document.getElementById('contactNameInput');
    els.contactCodeInput = document.getElementById('contactCodeInput');
    els.closeContactModalBtn = document.getElementById('closeContactModalBtn');
    els.saveContactBtn = document.getElementById('saveContactBtn');
    els.hudCodeDisplay = document.getElementById('hudCodeDisplay');
    els.hudPing = document.getElementById('hudPing');
    els.hudTransport = document.getElementById('hudTransport');
    els.hudBitrate = document.getElementById('hudBitrate');
    els.copyInviteBtn = document.getElementById('copyInviteBtn');
    els.quickStealthBtn = document.getElementById('quickStealthBtn');
    els.remoteGrid = document.getElementById('remoteGrid');
    els.waitingState = document.getElementById('waitingState');
    els.localVideo = document.getElementById('localVideo');
    els.remoteCanvas = document.getElementById('remoteCanvas');
    els.localCanvas = document.getElementById('localCanvas');
    els.localAvatar = document.getElementById('localAvatar');
    els.localInitials = document.getElementById('localInitials');
    els.localSpeakingWave = document.getElementById('localSpeakingWave');
    els.toggleMicBtn = document.getElementById('toggleMicBtn');
    els.toggleCamBtn = document.getElementById('toggleCamBtn');
    els.flipCamBtn = document.getElementById('flipCamBtn');
    els.shareScreenBtn = document.getElementById('shareScreenBtn');
    els.openSettingsBtn = document.getElementById('openSettingsBtn');
    els.hangupBtn = document.getElementById('hangupBtn');
    els.settingsModal = document.getElementById('settingsModal');
    els.closeSettingsBtn = document.getElementById('closeSettingsBtn');
    els.applySettingsBtn = document.getElementById('applySettingsBtn');
    els.modalPresetSelect = document.getElementById('modalPresetSelect');
    els.modalStealthToggle = document.getElementById('modalStealthToggle');
    els.statPing = document.getElementById('statPing');
    els.statLoss = document.getElementById('statLoss');
    els.statBitrate = document.getElementById('statBitrate');
    els.statProtocol = document.getElementById('statProtocol');
    els.toast = document.getElementById('toast');
  }

  // --- Initialize App ---
  function init() {
    console.log('[MyFam] Initializing application...');
    initElements();
    setupURLParams();
    setupEventListeners();
    connectSignaling();
    loadSavedSettings();
    renderContactsList();
  }

  function formatCode(raw) {
    const cleaned = (raw || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (cleaned.length > 3) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}`;
    }
    return cleaned;
  }

  function generateRandomCode() {
    const value = new Uint32Array(1);
    do { crypto.getRandomValues(value); } while (value[0] >= 4294800000);
    const num = (100000 + value[0] % 900000).toString();
    return `${num.slice(0, 3)}-${num.slice(3, 6)}`;
  }

  function setupURLParams() {
    const hash = window.location.hash.substring(1);
    if (!hash) return;

    let code = hash;
    if (hash.includes('code=')) {
      const params = new URLSearchParams(hash);
      code = params.get('code') || '';
    }

    if (code) {
      els.codeInput.value = formatCode(code);
    }
  }

  function syncSavedName() {
    const shouldRemember = !els.rememberNameCheckbox || els.rememberNameCheckbox.checked;
    storage.setItem('myfam_remember_name', shouldRemember ? 'true' : 'false');
    const trimmed = els.nameInput ? els.nameInput.value.trim() : '';
    if (shouldRemember && trimmed) {
      storage.setItem('myfam_myname', trimmed);
    } else {
      storage.removeItem('myfam_myname');
    }
  }

  function loadSavedSettings() {
    const rememberName = storage.getItem('myfam_remember_name') !== 'false';
    if (els.rememberNameCheckbox) els.rememberNameCheckbox.checked = rememberName;

    const savedName = storage.getItem('myfam_myname');
    if (rememberName && savedName && savedName !== 'Family Member') {
      els.nameInput.value = savedName;
    }

    const savedPreset = storage.getItem('myfam_preset');
    if (savedPreset && (PRESETS[savedPreset] || savedPreset === 'auto')) {
      state.currentPreset = savedPreset;
      els.presetSelect.value = savedPreset;
      els.modalPresetSelect.value = savedPreset;
    }

    if (!els.codeInput.value) {
      els.codeInput.value = generateRandomCode();
    }
  }

  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.remove('hidden');
    setTimeout(() => els.toast.classList.add('hidden'), 2800);
  }

  // --- Local Contacts Management ---
  function getLocalContacts() {
    try {
      const contacts = JSON.parse(storage.getItem('myfam_local_contacts') || '[]');
      return Array.isArray(contacts) ? contacts.filter(c => c && typeof c.name === 'string' && typeof c.code === 'string' && /^[a-z0-9]{3}-?[a-z0-9]{3}$/i.test(c.code)) : [];
    } catch (e) {
      return [];
    }
  }

  function saveLocalContacts(contacts) {
    storage.setItem('myfam_local_contacts', JSON.stringify(contacts));
    renderContactsList();
  }

  function addOrUpdateContact(name, code) {
    const cleanCode = formatCode(code);
    if (!cleanCode || !name) return;

    const contacts = getLocalContacts();
    const existingIndex = contacts.findIndex(c => c.code.replace('-', '') === cleanCode.replace('-', ''));

    if (existingIndex >= 0) {
      contacts[existingIndex].name = name.trim();
    } else {
      contacts.push({ name: name.trim(), code: cleanCode, addedAt: Date.now() });
    }

    saveLocalContacts(contacts);
    showToast(`Saved ${name} to your contacts`);
  }

  function deleteContact(code) {
    const cleanCode = formatCode(code);
    const contacts = getLocalContacts().filter(c => c.code.replace('-', '') !== cleanCode.replace('-', ''));
    saveLocalContacts(contacts);
    showToast('Contact removed');
  }

  function getContactNameForCode(code) {
    const cleanCode = (code || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const contacts = getLocalContacts();
    const match = contacts.find(c => c.code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() === cleanCode);
    return match ? match.name : null;
  }

  function renderContactsList() {
    const contacts = getLocalContacts();
    els.contactsList.innerHTML = '';

    if (contacts.length === 0) {
      els.contactsList.innerHTML = `
        <div class="empty-contacts">
          No saved contacts yet. Add family codes below or save them during a call.
        </div>
      `;
      return;
    }

    contacts.forEach(contact => {
      const initial = (contact.name || '?').trim().charAt(0).toUpperCase();
      const item = document.createElement('div');
      item.className = 'contact-item';
      item.innerHTML = `
        <div class="contact-left">
          <div class="contact-avatar">${escapeHtml(initial)}</div>
          <div class="contact-info">
            <span class="contact-name">${escapeHtml(contact.name)}</span>
            <span class="contact-code">${escapeHtml(contact.code)}</span>
          </div>
        </div>
        <div class="contact-actions">
          <button type="button" class="btn-dial" data-code="${escapeHtml(contact.code)}" title="Call ${escapeHtml(contact.name)}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
              <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
            </svg>
            <span>Call</span>
          </button>
          <button type="button" class="btn-icon btn-rename" data-code="${escapeHtml(contact.code)}" data-name="${escapeHtml(contact.name)}" title="Rename in Contacts">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
          </button>
          <button type="button" class="btn-icon btn-icon-danger btn-del" data-code="${escapeHtml(contact.code)}" title="Delete">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      `;
      els.contactsList.appendChild(item);
    });

    els.contactsList.querySelectorAll('.btn-dial').forEach(btn => {
      btn.addEventListener('click', () => {
        els.codeInput.value = btn.dataset.code;
        handleJoinSubmit();
      });
    });

    els.contactsList.querySelectorAll('.btn-rename').forEach(btn => {
      btn.addEventListener('click', () => {
        openContactModal('Rename Contact', btn.dataset.name, btn.dataset.code);
      });
    });

    els.contactsList.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', () => {
        deleteContact(btn.dataset.code);
      });
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function openContactModal(title, defaultName = '', defaultCode = '') {
    els.contactModalTitle.textContent = title;
    els.contactNameInput.value = defaultName;
    els.contactCodeInput.value = defaultCode;
    els.contactModal.classList.remove('hidden');
    els.contactNameInput.focus();
  }

  // --- Signaling Client ---
  function connectSignaling() {
    if (state.ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(state.ws.readyState)) return;
    clearTimeout(state.reconnectTimer);
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    updateServerStatus('connecting', 'Connecting...');

    const socket = new WebSocket(wsUrl);
    state.ws = socket;
    state.ws.binaryType = 'arraybuffer';

    state.ws.onopen = () => {
      if (state.ws !== socket) return;
      updateServerStatus('connected', 'Ready');
      startPingHeartbeat();
      if (state.activeCode) sendSignaling('join', { code: state.activeCode, name: state.userName });
    };

    state.ws.onclose = () => {
      if (state.ws !== socket) return;
      updateServerStatus('error', 'Disconnected');
      stopPingHeartbeat();
      if (state.activeCode) {
        cleanupPeer();
        updateRouteBadge('Reconnecting...', 'checking');
        showToast('Connection lost. Reconnecting to your call...');
      } else if (state.joining) {
        failJoin('Connection lost. Please try again.');
      }
      state.reconnectTimer = setTimeout(connectSignaling, 1500);
    };

    state.ws.onerror = () => {
      updateServerStatus('error', 'Connection Error');
    };

    state.ws.onmessage = event => {
      if (state.ws === socket) handleSignalingMessage(event).catch(err => {
        console.error('[Signaling]', err);
        showToast('Call setup failed. Try the relay or rejoin.');
      });
    };
  }

  function updateServerStatus(status, text) {
    els.serverStatusBadge.className = `status-badge status-${status}`;
    els.serverStatusText.textContent = text;
  }

  function sendSignaling(type, payload = {}) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type, payload }));
    }
  }

  function startPingHeartbeat() {
    stopPingHeartbeat();
    state.pingInterval = setInterval(() => {
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        sendSignaling('ping', { clientTime: Date.now() });
      }
    }, 4000);
  }

  function stopPingHeartbeat() {
    if (state.pingInterval) {
      clearInterval(state.pingInterval);
      state.pingInterval = null;
    }
  }

  // --- Signaling Message Router ---
  async function handleSignalingMessage(event) {
    if (event.data instanceof ArrayBuffer) {
      handleStealthBinaryPacket(event.data);
      return;
    }

    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      return;
    }

    const { type, payload } = msg;

    switch (type) {
      case 'pong': {
        if (payload?.clientTime) {
          const rtt = Date.now() - payload.clientTime;
          state.currentPing = rtt;
          els.hudPing.textContent = `${rtt} ms`;
          els.statPing.textContent = `${rtt} ms`;
        }
        break;
      }

      case 'joined': {
        if (!state.joining && !state.activeCode) { sendSignaling('leave'); break; }
        resetJoinButton();
        state.clientId = payload.clientId;
        state.activeCode = payload.code;
        state.iceServers = payload.iceServers || [];
        showCallView();
        setupAudioVisualizer(state.localStream, els.localSpeakingWave);

        if (payload.peers && payload.peers.length > 0) {
          for (const p of payload.peers) {
            ensurePeer(p.id, p.name);
            sendSignaling('camera-toggle', { targetId: p.id, enabled: !state.isVideoOff });
            if (!state.forceStealth) {
              await initiateCall(p.id);
            }
          }
          if (state.forceStealth) {
            activateStealthMode();
          }
        }
        break;
      }

      case 'peer-joined': {
        const peer = ensurePeer(payload.id, payload.name);
        showToast(`${peer.name} joined`);
        if (!peer.pc) {
          createPeerConnection(payload.id);
        }
        sendSignaling('camera-toggle', { targetId: payload.id, enabled: !state.isVideoOff });
        if (state.forceStealth) activateStealthMode();
        break;
      }

      case 'offer': {
        if (state.isStealthActive) break;
        if (payload.senderId) {
          ensurePeer(payload.senderId, payload.senderName);
          await handleRemoteOffer(payload);
        }
        break;
      }

      case 'answer': {
        await handleRemoteAnswer(payload);
        break;
      }

      case 'candidate': {
        await handleRemoteCandidate(payload);
        break;
      }

      case 'stealth-toggle': {
        if (payload.enabled) {
          activateStealthMode(false);
        } else {
          deactivateStealthMode(false);
        }
        break;
      }

      case 'camera-toggle': {
        const peer = state.peers.get(payload.senderId);
        if (peer) {
          peer.hasVideo = !!payload.enabled;
          if (!state.isStealthActive) {
            peer.videoEl.classList.toggle('hidden', !peer.hasVideo);
            peer.avatarEl.classList.toggle('hidden', peer.hasVideo);
          }
        }
        break;
      }

      case 'peer-left': {
        const peer = state.peers.get(payload.id);
        showToast(`${peer ? peer.name : 'Participant'} left`);
        removePeer(payload.id);
        break;
      }

      case 'error': {
        if (state.activeCode) leaveCall();
        failJoin(payload.message || 'An error occurred');
        break;
      }
    }
  }

  function resolvePeerDisplayName(serverGivenName, code) {
    const contactName = getContactNameForCode(code);
    if (contactName) return contactName;
    return serverGivenName || 'Family Member';
  }

  // --- WebRTC Multi-Peer Mesh Core (up to 5 participants) ---

  function updateGridLayout() {
    const count = state.peers.size;
    els.remoteGrid.dataset.count = String(Math.min(count, 4));
    els.waitingState.classList.toggle('hidden', count > 0 || state.isStealthActive);
  }

  function ensurePeer(peerId, rawName) {
    if (state.peers.has(peerId)) {
      const existing = state.peers.get(peerId);
      if (rawName) {
        existing.name = resolvePeerDisplayName(rawName, state.activeCode);
        existing.nameEl.textContent = existing.name;
        existing.initialsEl.textContent = existing.name.charAt(0).toUpperCase();
      }
      return existing;
    }

    const displayName = resolvePeerDisplayName(rawName, state.activeCode);
    const tile = document.createElement('div');
    tile.className = 'remote-tile';
    tile.dataset.peerId = peerId;
    tile.innerHTML = `
      <video autoplay playsinline class="hidden"></video>
      <div class="avatar-display">
        <div class="avatar-circle">
          <span class="tile-initials">${escapeHtml(displayName.charAt(0).toUpperCase())}</span>
          <div class="speaking-ring"></div>
        </div>
      </div>
      <div class="remote-tile-label">
        <span class="tile-name">${escapeHtml(displayName)}</span>
        <button type="button" class="pill-icon-btn tile-rename-btn" title="Save or rename contact">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
          </svg>
        </button>
      </div>
    `;

    const peer = {
      id: peerId,
      name: displayName,
      pc: null,
      stream: null,
      pendingCandidates: [],
      iceTimeoutTimer: null,
      hasVideo: false,
      tileEl: tile,
      videoEl: tile.querySelector('video'),
      avatarEl: tile.querySelector('.avatar-display'),
      initialsEl: tile.querySelector('.tile-initials'),
      nameEl: tile.querySelector('.tile-name'),
      waveEl: tile.querySelector('.speaking-ring')
    };

    tile.querySelector('.tile-rename-btn').addEventListener('click', () => {
      if (!state.activeCode) return;
      openContactModal('Save Contact', peer.name, formatCode(state.activeCode));
    });

    els.remoteGrid.appendChild(tile);
    state.peers.set(peerId, peer);
    updateGridLayout();
    return peer;
  }

  function closePeerConnection(peer) {
    clearIceTimeout(peer.id);
    if (peer.pc) {
      peer.pc.ontrack = null;
      peer.pc.onicecandidate = null;
      peer.pc.oniceconnectionstatechange = null;
      peer.pc.close();
      peer.pc = null;
    }
  }

  function removePeer(peerId) {
    const peer = state.peers.get(peerId);
    if (!peer) return;
    closePeerConnection(peer);
    state.visualizers.get(peer.waveEl)?.();
    state.visualizers.delete(peer.waveEl);
    peer.videoEl.srcObject = null;
    peer.tileEl.remove();
    state.peers.delete(peerId);
    updateGridLayout();
    if (state.peers.size === 0) {
      deactivateStealthMode(false, false);
      updateRouteBadge('Waiting for family', 'checking');
    }
  }

  function createPeerConnection(peerId) {
    const peer = ensurePeer(peerId);
    closePeerConnection(peer);

    const config = {
      iceServers: state.iceServers.length > 0 ? state.iceServers : [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.services.mozilla.com:3478' },
        { urls: 'stun:stun.nextcloud.com:443' },
        { urls: 'stun:stun.relay.metered.ca:80' }
      ],
      iceCandidatePoolSize: 2,
      bundlePolicy: 'max-bundle'
    };

    const pc = new RTCPeerConnection(config);
    peer.pc = pc;

    if (state.localStream) {
      state.localStream.getTracks().forEach(track => {
        pc.addTrack(track, state.localStream);
      });
    }

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        peer.stream = event.streams[0];
        peer.videoEl.srcObject = peer.stream;

        const videoTrack = peer.stream.getVideoTracks()[0];
        if (videoTrack && videoTrack.enabled && peer.hasVideo !== false) {
          peer.videoEl.classList.remove('hidden');
          peer.avatarEl.classList.add('hidden');
        } else {
          peer.videoEl.classList.add('hidden');
          peer.avatarEl.classList.remove('hidden');
        }

        if (videoTrack) {
          videoTrack.onmute = () => {
            if (!state.isStealthActive) {
              peer.videoEl.classList.add('hidden');
              peer.avatarEl.classList.remove('hidden');
            }
          };
          videoTrack.onunmute = () => {
            if (!state.isStealthActive) {
              peer.videoEl.classList.remove('hidden');
              peer.avatarEl.classList.add('hidden');
            }
          };
        }

        peer.videoEl.play().catch(() => {
          peer.videoEl.muted = true;
          peer.videoEl.play().then(() => {
            setTimeout(() => { peer.videoEl.muted = false; }, 150);
          }).catch(() => {});
        });

        setupAudioVisualizer(peer.stream, peer.waveEl);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignaling('candidate', {
          targetId: peerId,
          candidate: event.candidate
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      if (peer.pc !== pc || state.isStealthActive) return;

      if (iceState === 'connected' || iceState === 'completed') {
        clearIceTimeout(peerId);
        updateRouteBadge('P2P Direct', 'connected');
        applyBitrateConstraints();
      } else if (iceState === 'checking') {
        updateRouteBadge('Connecting...', 'checking');
        startIceTimeout(peerId);
      } else if (iceState === 'disconnected') {
        startIceTimeout(peerId);
      } else if (iceState === 'failed') {
        clearIceTimeout(peerId);
        if (state.peers.size === 1) {
          activateStealthMode();
        }
      }
    };

    return pc;
  }

  // 6-Second Auto-Fallback: If carrier NAT or firewall blocks P2P UDP in a 1-on-1 call, auto-switch to port 443 tunnel
  function startIceTimeout(peerId) {
    clearIceTimeout(peerId);
    const peer = state.peers.get(peerId);
    if (!peer) return;
    peer.iceTimeoutTimer = setTimeout(() => {
      if (!peer.pc) return;
      const iceState = peer.pc.iceConnectionState;
      if (['checking', 'new', 'disconnected'].includes(iceState) && state.peers.size === 1) {
        showToast('NAT/Firewall detected. Routing media over TLS port 443...');
        activateStealthMode();
      }
    }, 6000);
  }

  function clearIceTimeout(peerId) {
    const peer = state.peers.get(peerId);
    if (peer && peer.iceTimeoutTimer) {
      clearTimeout(peer.iceTimeoutTimer);
      peer.iceTimeoutTimer = null;
    }
  }

  async function initiateCall(targetId) {
    const pc = createPeerConnection(targetId);
    startIceTimeout(targetId);
    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });

      let finalSdp = offer.sdp;
      try {
        finalSdp = optimizeSdp(offer.sdp);
        await pc.setLocalDescription(new RTCSessionDescription({ type: 'offer', sdp: finalSdp }));
      } catch (sdpErr) {
        await pc.setLocalDescription(offer);
        finalSdp = offer.sdp;
      }

      sendSignaling('offer', {
        targetId,
        sdp: finalSdp
      });
    } catch (err) {
      console.error('[WebRTC] Error initiating call:', err);
      if (state.peers.size === 1) activateStealthMode();
    }
  }

  async function handleRemoteOffer(payload) {
    const pc = createPeerConnection(payload.senderId);
    const peer = state.peers.get(payload.senderId);
    try {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: payload.sdp }));
      await flushPendingCandidates(peer);

      const answer = await pc.createAnswer();
      let finalSdp = answer.sdp;
      try {
        finalSdp = optimizeSdp(answer.sdp);
        await pc.setLocalDescription(new RTCSessionDescription({ type: 'answer', sdp: finalSdp }));
      } catch (sdpErr) {
        await pc.setLocalDescription(answer);
        finalSdp = answer.sdp;
      }

      sendSignaling('answer', {
        targetId: payload.senderId,
        sdp: finalSdp
      });
    } catch (err) {
      console.error('[WebRTC] Error answering call:', err);
      if (state.peers.size === 1) activateStealthMode();
    }
  }

  async function handleRemoteAnswer(payload) {
    const peer = state.peers.get(payload.senderId);
    if (!peer || !peer.pc) return;
    try {
      await peer.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: payload.sdp }));
      await flushPendingCandidates(peer);
    } catch (err) {
      console.error('[WebRTC] Error setting answer:', err);
    }
  }

  async function handleRemoteCandidate(payload) {
    if (!payload.candidate || !payload.senderId) return;
    const peer = ensurePeer(payload.senderId);
    const cand = new RTCIceCandidate(payload.candidate);

    if (!peer.pc || !peer.pc.remoteDescription) {
      peer.pendingCandidates.push(cand);
      return;
    }

    try {
      await peer.pc.addIceCandidate(cand);
    } catch (err) {
      console.warn('[WebRTC] Error adding ICE candidate:', err);
    }
  }

  async function flushPendingCandidates(peer) {
    if (!peer || !peer.pc || !peer.pc.remoteDescription) return;
    while (peer.pendingCandidates.length > 0) {
      const cand = peer.pendingCandidates.shift();
      try {
        await peer.pc.addIceCandidate(cand);
      } catch (e) {
        console.warn('[WebRTC] Error adding queued candidate:', e);
      }
    }
  }

  // Opus In-Band FEC
  function optimizeSdp(sdp) {
    const preset = getEffectivePreset();
    let lines = sdp.split('\r\n');

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('a=fmtp:') && lines[i].includes('minptime=')) {
        lines[i] = lines[i].replace(/;(useinbandfec|maxaveragebitrate|stereo|cbr)=[^;\r\n]*/g, '');
        lines[i] += `;useinbandfec=1;maxaveragebitrate=${preset.audioBitrate};stereo=0;cbr=1`;
      }
    }

    return lines.join('\r\n');
  }

  async function applyBitrateConstraints() {
    if (state.isStealthActive) {
      if (!state.isVideoOff) startStealthVideoStream();
      return;
    }
    if (state.peers.size === 0) return;
    const preset = getEffectivePreset();

    for (const peer of state.peers.values()) {
      if (!peer.pc) continue;
      try {
        const senders = peer.pc.getSenders();
        for (const sender of senders) {
          if (!sender.track) continue;
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];

          if (sender.track.kind === 'video') {
            if (state.isVideoOff) {
              params.encodings[0].active = false;
              params.encodings[0].maxBitrate = 0;
            } else {
              params.encodings[0].active = true;
              params.encodings[0].maxBitrate = preset.videoBitrate;
              if (typeof preset.frameRate === 'number') {
                params.encodings[0].maxFramerate = preset.frameRate;
              }
            }
            await sender.setParameters(params);
          } else if (sender.track.kind === 'audio') {
            params.encodings[0].maxBitrate = preset.audioBitrate;
            await sender.setParameters(params);
          }
        }
      } catch (e) {
        console.warn('[WebRTC] Set sender parameters error:', e);
      }
    }
  }

  function setStealthUiState(active) {
    if (els.modalStealthToggle) els.modalStealthToggle.checked = active;
    if (els.quickStealthBtn) {
      els.quickStealthBtn.classList.toggle('active', active);
      els.quickStealthBtn.textContent = active ? 'Relay: ON' : 'Relay';
    }
  }

  function toggleStealthPreference(enable) {
    state.forceStealth = enable;
    if (state.peers.size === 0) {
      setStealthUiState(enable);
      updateRouteBadge(enable ? 'Relay Armed' : 'Waiting', enable ? 'stealth' : 'checking');
      showToast(enable ? 'Relay enabled — will connect via server.' : 'Relay disabled — will use direct P2P.');
      return;
    }
    if (enable) activateStealthMode();
    else deactivateStealthMode();
  }

  // --- Dual-Engine: "Stealth Mode" (TLS Port 443 WebSocket Tunneling) ---
  function activateStealthMode(notifyPeer = true) {
    if (state.isStealthActive || state.peers.size === 0) return;
    state.isStealthActive = true;
    state.forceStealth = true;
    for (const peer of state.peers.values()) {
      closePeerConnection(peer);
      peer.pendingCandidates = [];
      peer.videoEl.pause();
      peer.videoEl.srcObject = null;
      peer.videoEl.classList.add('hidden');
      if (notifyPeer) sendSignaling('stealth-toggle', { targetId: peer.id, enabled: true });
    }
    updateGridLayout();
    updateRouteBadge('WebSocket Relay', 'stealth');
    showToast('Relay active via TLS port 443.');
    setStealthUiState(true);
    els.remoteGrid.classList.add('hidden');
    els.remoteCanvas.classList.remove('hidden');
    startStealthAudioStream();
    if (!state.isVideoOff) startStealthVideoStream();
  }

  function deactivateStealthMode(notifyPeer = true, reconnect = true) {
    if (!state.isStealthActive) return;
    state.isStealthActive = false;
    state.forceStealth = false;
    stopStealthAudioStream();
    stopStealthVideoStream();
    if (state.stealthAudioContext) {
      state.stealthAudioContext.close().catch(() => {});
      state.stealthAudioContext = null;
    }
    state.nextAudioTime = 0;
    setStealthUiState(false);
    els.remoteCanvas.classList.add('hidden');
    els.remoteGrid.classList.remove('hidden');
    updateGridLayout();
    if (reconnect && state.peers.size > 0) {
      updateRouteBadge('Connecting...', 'checking');
      showToast('Switching back to direct P2P...');
      for (const peer of state.peers.values()) {
        if (notifyPeer) sendSignaling('stealth-toggle', { targetId: peer.id, enabled: false });
        if (state.clientId < peer.id) initiateCall(peer.id);
      }
    }
  }

  async function prepareAudio() {
    if (!state.audioContext || state.audioContext.state === 'closed') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      state.audioContext = new AudioCtx();
      state.audioModule = state.audioContext.audioWorklet.addModule('audio-worklet.js');
    }
    await state.audioContext.resume();
    await state.audioModule;
    return state.audioContext;
  }

  async function startStealthAudioStream() {
    stopStealthAudioStream();
    const stream = state.localStream;
    if (!stream?.getAudioTracks().length) return;
    try {
      const ctx = await prepareAudio();
      if (!state.isStealthActive || state.localStream !== stream) return;
      const source = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      const node = new AudioWorkletNode(ctx, 'relay-audio');
      state.stealthAudioSource = source;
      state.stealthAudioNode = node;
      node.port.onmessage = ({ data }) => {
        if (!state.isStealthActive || state.isAudioMuted || state.stealthAudioNode !== node) return;
        // Echo-loop guard: suppress Relay mic transmission while remote Relay audio is playing (+120ms tail)
        if (state.stealthAudioContext && state.stealthAudioContext.currentTime < state.nextAudioTime + 0.12) return;
        if (state.ws?.readyState !== WebSocket.OPEN || state.ws.bufferedAmount > 16 * 1024) return;
        const packet = new Uint8Array(data.byteLength + 1);
        packet[0] = 0x01; // 16 kHz, mono, signed PCM16 little endian
        packet.set(new Uint8Array(data), 1);
        state.ws.send(packet.buffer);
      };
      source.connect(node);
      // The processor emits silence locally to prevent microphone feedback.
      node.connect(ctx.destination);
    } catch (err) {
      console.error('[Relay] Audio setup failed:', err);
      showToast('Relay audio unavailable. Use a current browser over HTTPS.');
    }
  }

  function stopStealthAudioStream() {
    if (state.stealthAudioNode) {
      state.stealthAudioNode.port.onmessage = null;
      state.stealthAudioNode.disconnect();
      state.stealthAudioNode = null;
    }
    if (state.stealthAudioSource) {
      state.stealthAudioSource.disconnect();
      state.stealthAudioSource = null;
    }
  }

  function startStealthVideoStream() {
    stopStealthVideoStream();
    if (!state.localStream || state.isVideoOff) return;

    const preset = getEffectivePreset();
    const intervalMs = Math.round(1000 / preset.stealthFps);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    let encoding = false;
    const generation = state.callGeneration;
    state.stealthVideoTimer = setInterval(() => {
      if (encoding || !state.isStealthActive || !els.localVideo.videoWidth || !els.localVideo.videoHeight || state.isVideoOff || state.ws?.bufferedAmount > 16 * 1024) return;
      encoding = true;

      // Preserve the camera's native portrait/landscape aspect ratio
      const vw = els.localVideo.videoWidth;
      const vh = els.localVideo.videoHeight;
      const maxDim = Math.max(preset.width.ideal, preset.height.ideal);
      const scale = Math.min(1, maxDim / Math.max(vw, vh));
      const targetW = Math.max(2, Math.round((vw * scale) / 2) * 2);
      const targetH = Math.max(2, Math.round((vh * scale) / 2) * 2);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      ctx.drawImage(els.localVideo, 0, 0, targetW, targetH);

      canvas.toBlob((blob) => {
        if (!blob || !state.isStealthActive || generation !== state.callGeneration || state.isVideoOff || state.ws?.readyState !== WebSocket.OPEN) { encoding = false; return; }
        blob.arrayBuffer().then((buffer) => {
          if (!state.isStealthActive || state.isVideoOff || generation !== state.callGeneration || state.ws?.readyState !== WebSocket.OPEN || state.ws.bufferedAmount > 16 * 1024 || buffer.byteLength > 250 * 1024) return;
          const packet = new Uint8Array(buffer.byteLength + 1);
          packet[0] = 0x02; // Video
          packet.set(new Uint8Array(buffer), 1);
          state.ws.send(packet.buffer);
        }).catch(() => {}).finally(() => { encoding = false; });
      }, 'image/jpeg', preset.stealthQuality);
    }, intervalMs);
  }

  function stopStealthVideoStream() {
    if (state.stealthVideoTimer) {
      clearInterval(state.stealthVideoTimer);
      state.stealthVideoTimer = null;
    }
  }

  function handleStealthBinaryPacket(arrayBuffer) {
    if (!state.activeCode || state.peers.size === 0 || arrayBuffer.byteLength < 2) return;
    if (!state.isStealthActive) {
      activateStealthMode(false);
    }

    const view = new Uint8Array(arrayBuffer);
    const packetType = view[0];
    const dataBytes = arrayBuffer.slice(1);

    if (packetType === 0x01) {
      playStealthAudioChunk(dataBytes);
    } else if (packetType === 0x02) {
      renderStealthVideoFrame(dataBytes);
    }
  }

  function playStealthAudioChunk(arrayBuffer) {
    const ctx = state.audioContext;
    if (!ctx || ctx.state !== 'running' || arrayBuffer.byteLength % 2 || arrayBuffer.byteLength > 3200) return;
    // Bound queued playback to avoid seconds of stale speech on a slow link.
    if (state.nextAudioTime - ctx.currentTime > 0.25) return;
    const samples = new DataView(arrayBuffer);
    const buffer = ctx.createBuffer(1, arrayBuffer.byteLength / 2, 16000);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < output.length; i++) output[i] = samples.getInt16(i * 2, true) / 32768;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const start = Math.max(ctx.currentTime + 0.02, state.nextAudioTime);
    source.start(start);
    state.nextAudioTime = start + buffer.duration;
    const firstPeer = state.peers.values().next().value;
    if (firstPeer) triggerSpeakingAnimation(firstPeer.waveEl);
  }

  function renderStealthVideoFrame(arrayBuffer) {
    const blob = new Blob([arrayBuffer], { type: 'image/jpeg' });
    const imgUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      if (!state.isStealthActive) { URL.revokeObjectURL(imgUrl); return; }
      const canvas = els.remoteCanvas;
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(imgUrl);

      els.remoteCanvas.classList.remove('hidden');
    };
    img.onerror = () => URL.revokeObjectURL(imgUrl);
    img.src = imgUrl;
  }

  // --- Audio Visualizer ---
  function setupAudioVisualizer(stream, targetElement) {
    state.visualizers.get(targetElement)?.();
    if (!stream?.getAudioTracks().length || !state.activeCode) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      let frame;
      state.visualizers.set(targetElement, () => {
        cancelAnimationFrame(frame);
        audioCtx.close().catch(() => {});
        targetElement.parentElement.parentElement.classList.remove('is-speaking');
      });
      function checkVolume() {
        if (!state.activeCode) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
        const avg = sum / bufferLength;

        if (avg > 18) {
          targetElement.parentElement.parentElement.classList.add('is-speaking');
        } else {
          targetElement.parentElement.parentElement.classList.remove('is-speaking');
        }
        frame = requestAnimationFrame(checkVolume);
      }
      checkVolume();
    } catch (e) {}
  }

  function triggerSpeakingAnimation(elem) {
    elem.parentElement.parentElement.classList.add('is-speaking');
    setTimeout(() => elem.parentElement.parentElement.classList.remove('is-speaking'), 300);
  }

  // --- Media Stream Management ---
  async function startLocalMedia() {
    const generation = state.callGeneration;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showJoinError('Media access requires HTTPS or browser permission. Please check your browser address has https://');
      return false;
    }

    const preset = getEffectivePreset();
    const audioConstraints = {
      echoCancellation: { ideal: true },
      noiseSuppression: { ideal: true },
      autoGainControl: { ideal: true },
      channelCount: { ideal: 1 }
    };

    // Tier 1: Try requested video & audio with mobile-safe ideal constraints
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: { facingMode: state.facingMode, width: { ideal: preset.width.ideal }, height: { ideal: preset.height.ideal } }
      });
    } catch (e1) {
      console.warn('[Media] Tier 1 camera failed, trying simple video:', e1);
      try {
        // Tier 2: Simplest video constraints (keep audio echo/noise suppression)
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: true });
      } catch (e2) {
        console.warn('[Media] Simple video failed, falling back to audio only:', e2);
        showToast('Camera not accessible. Voice only mode.');
        state.isVideoOff = true;
      }
    }

    // Tier 3: Audio only if video failed
    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
        state.isVideoOff = true;
      } catch (err) {
        console.error('[Media] Audio getUserMedia error:', err);
        showJoinError('Microphone permission required. Please allow microphone in browser settings.');
        return false;
      }
    }

    if (generation !== state.callGeneration) { stream.getTracks().forEach(t => t.stop()); return false; }
    stopLocalMedia();
    state.localStream = stream;
    stream.getAudioTracks().forEach(t => { t.enabled = !state.isAudioMuted; });
    els.localVideo.srcObject = state.localStream;

    const hasVideo = stream.getVideoTracks().length > 0;
    state.isVideoOff = !hasVideo;
    if (!hasVideo) {
      state.isVideoOff = true;
      els.localVideo.classList.add('hidden');
      els.localAvatar.classList.remove('hidden');
      els.toggleCamBtn.classList.add('active-off');
      els.toggleCamBtn.querySelector('.icon-cam-on').classList.add('hidden');
      els.toggleCamBtn.querySelector('.icon-cam-off').classList.remove('hidden');
    } else {
      state.isVideoOff = false;
      els.localVideo.classList.remove('hidden');
      els.localAvatar.classList.add('hidden');
      els.toggleCamBtn.classList.remove('active-off');
      els.toggleCamBtn.querySelector('.icon-cam-on').classList.remove('hidden');
      els.toggleCamBtn.querySelector('.icon-cam-off').classList.add('hidden');
    }

    setupAudioVisualizer(state.localStream, els.localSpeakingWave);
    return true;
  }

  function stopLocalMedia() {
    state.visualizers.get(els.localSpeakingWave)?.();
    state.visualizers.delete(els.localSpeakingWave);
    if (state.localStream) {
      state.localStream.getTracks().forEach(track => track.stop());
      state.localStream = null;
    }
    els.localVideo.srcObject = null;
  }

  // --- Call Toolbar Controls ---
  function toggleMicrophone() {
    if (!state.localStream) return;
    const audioTrack = state.localStream.getAudioTracks()[0];
    if (!audioTrack) return;

    state.isAudioMuted = !state.isAudioMuted;
    audioTrack.enabled = !state.isAudioMuted;

    els.toggleMicBtn.classList.toggle('active-off', state.isAudioMuted);
    els.toggleMicBtn.querySelector('.icon-mic-on').classList.toggle('hidden', state.isAudioMuted);
    els.toggleMicBtn.querySelector('.icon-mic-off').classList.toggle('hidden', !state.isAudioMuted);

    showToast(state.isAudioMuted ? 'Muted' : 'Unmuted');
  }

  function toggleCamera() {
    if (!state.localStream) return;
    const videoTrack = state.localStream.getVideoTracks()[0];
    if (!videoTrack) {
      showToast('No camera found on this device');
      return;
    }

    state.isVideoOff = !state.isVideoOff;
    videoTrack.enabled = !state.isVideoOff;

    els.toggleCamBtn.classList.toggle('active-off', state.isVideoOff);
    els.toggleCamBtn.querySelector('.icon-cam-on').classList.toggle('hidden', state.isVideoOff);
    els.toggleCamBtn.querySelector('.icon-cam-off').classList.toggle('hidden', !state.isVideoOff);

    els.localVideo.classList.toggle('hidden', state.isVideoOff);
    els.localAvatar.classList.toggle('hidden', !state.isVideoOff);

    // Enforce voice-only bandwidth saving or restore video
    applyBitrateConstraints();

    for (const peerId of state.peers.keys()) {
      sendSignaling('camera-toggle', { targetId: peerId, enabled: !state.isVideoOff });
    }

    if (state.isStealthActive) {
      if (state.isVideoOff) stopStealthVideoStream();
      else startStealthVideoStream();
    }

    showToast(state.isVideoOff ? 'Camera off (Voice Only)' : 'Camera turned on');
  }

  async function flipCamera() {
    if (state.isVideoOff || !state.localStream) return;

    state.facingMode = state.facingMode === 'user' ? 'environment' : 'user';
    const preset = getEffectivePreset();

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: state.facingMode,
          width: preset.width,
          height: preset.height,
          frameRate: preset.frameRate
        }
      });

      const newTrack = newStream.getVideoTracks()[0];
      const oldTrack = state.localStream.getVideoTracks()[0];

      if (oldTrack) {
        state.localStream.removeTrack(oldTrack);
        oldTrack.stop();
      }
      state.localStream.addTrack(newTrack);
      els.localVideo.srcObject = state.localStream;

      for (const peer of state.peers.values()) {
        if (peer.pc) {
          const sender = peer.pc.getSenders().find(s => s.track && s.track.kind === 'video');
          if (sender) sender.replaceTrack(newTrack);
        }
      }

      showToast(`Switched to ${state.facingMode === 'user' ? 'front' : 'back'} camera`);
    } catch (e) {
      showToast('Camera switch unavailable');
    }
  }

  async function toggleScreenShare() {
    if (!navigator.mediaDevices.getDisplayMedia) {
      showToast('Screen sharing is not supported in this browser');
      return;
    }

    if (state.isScreenSharing) {
      await startLocalMedia();
      state.isScreenSharing = false;
      els.shareScreenBtn.classList.remove('active-off');
      showToast('Screen sharing stopped');
      return;
    }

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = screenStream.getVideoTracks()[0];

      screenTrack.onended = () => {
        if (state.isScreenSharing) toggleScreenShare();
      };

      const oldTrack = state.localStream.getVideoTracks()[0];
      if (oldTrack) {
        state.localStream.removeTrack(oldTrack);
        oldTrack.stop();
      }
      state.localStream.addTrack(screenTrack);
      els.localVideo.srcObject = state.localStream;

      for (const peer of state.peers.values()) {
        if (peer.pc) {
          const sender = peer.pc.getSenders().find(s => s.track && s.track.kind === 'video');
          if (sender) sender.replaceTrack(screenTrack);
        }
      }

      state.isScreenSharing = true;
      els.shareScreenBtn.classList.add('active-off');
      showToast('Sharing screen');
    } catch (e) {}
  }

  // --- Diagnostics Monitor & Dynamic Auto-Adaptive Quality ---
  function startStatsMonitor() {
    stopStatsMonitor();
    state.lastBytesReceived = 0;
    state.lastStatsTime = 0;
    state.lastPacketsLost = 0;
    state.lastPacketsTotal = 0;
    state.goodNetworkCycles = 0;

    state.statsInterval = setInterval(async () => {
      const activePcs = Array.from(state.peers.values()).map(p => p.pc).filter(Boolean);
      if (activePcs.length === 0) {
        if (state.isStealthActive) {
          els.hudBitrate.textContent = 'Relay 443';
          els.statBitrate.textContent = 'Active';
          els.statProtocol.textContent = 'WSS TLS';
        }
        return;
      }

      try {
        let bytesRecv = 0;
        let packetsLost = 0;
        let packetsTotal = 0;
        let activeTransport = 'P2P Direct';

        for (const pc of activePcs) {
          const stats = await pc.getStats();
          stats.forEach(report => {
            if (report.type === 'inbound-rtp') {
              bytesRecv += report.bytesReceived || 0;
              packetsLost += report.packetsLost || 0;
              packetsTotal += (report.packetsReceived || 0) + (report.packetsLost || 0);
            }
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
              const localCand = stats.get(report.localCandidateId);
              if (localCand && (localCand.candidateType === 'relay' || localCand.protocol === 'tcp')) {
                activeTransport = 'WebRTC Relay (TCP)';
              }
            }
          });
        }

        const now = Date.now();
        if (state.lastStatsTime > 0) {
          const deltaSec = (now - state.lastStatsTime) / 1000;
          const bits = (bytesRecv - state.lastBytesReceived) * 8;
          const kbps = Math.max(0, Math.round(bits / deltaSec / 1000));
          els.hudBitrate.textContent = `${kbps} kbps`;
          els.statBitrate.textContent = `${kbps} kbps`;
        }
        state.lastBytesReceived = bytesRecv;
        state.lastStatsTime = now;

        let deltaLossPct = 0;
        if (packetsTotal > 0) {
          const lossRate = ((packetsLost / packetsTotal) * 100).toFixed(1);
          els.statLoss.textContent = `${lossRate}%`;

          const deltaLost = Math.max(0, packetsLost - (state.lastPacketsLost || 0));
          const deltaTotal = Math.max(0, packetsTotal - (state.lastPacketsTotal || 0));
          if (deltaTotal > 0) {
            deltaLossPct = (deltaLost / deltaTotal) * 100;
          }
          state.lastPacketsLost = packetsLost;
          state.lastPacketsTotal = packetsTotal;
        }

        els.statProtocol.textContent = activeTransport;

        // Auto-Adaptive Quality Engine (caps max tier for 3+ peer mesh to protect upload bandwidth)
        if (state.currentPreset === 'auto' && !state.isVideoOff && packetsTotal > 0) {
          const maxTierIdx = state.peers.size >= 3 ? 1 : (state.peers.size === 2 ? 2 : QUALITY_TIERS.length - 1);
          const currentTierIdx = QUALITY_TIERS.indexOf(state.activeTier);

          const isStruggling = deltaLossPct > 5 || (state.currentPing !== null && state.currentPing > 380) || currentTierIdx > maxTierIdx;
          const isHealthy = deltaLossPct < 1 && (state.currentPing === null || state.currentPing < 160);

          if (isStruggling) {
            state.goodNetworkCycles = 0;
            if (currentTierIdx > 0) {
              state.activeTier = QUALITY_TIERS[Math.min(currentTierIdx - 1, maxTierIdx)];
              applyBitrateConstraints();
            }
          } else if (isHealthy) {
            state.goodNetworkCycles = (state.goodNetworkCycles || 0) + 1;
            if (state.goodNetworkCycles >= 5) {
              state.goodNetworkCycles = 0;
              if (currentTierIdx < maxTierIdx) {
                state.activeTier = QUALITY_TIERS[currentTierIdx + 1];
                applyBitrateConstraints();
              }
            }
          } else {
            state.goodNetworkCycles = 0;
          }
        }
      } catch (e) {}
    }, 2000);
  }

  function stopStatsMonitor() {
    if (state.statsInterval) {
      clearInterval(state.statsInterval);
      state.statsInterval = null;
    }
  }

  function updateRouteBadge(label, badgeClass) {
    els.hudTransport.textContent = label;
    els.hudTransport.className = `hud-badge ${badgeClass}`;
  }

  // --- Views ---
  function showCallView() {
    els.lobbyView.classList.remove('active');
    els.callView.classList.add('active');
    els.hudCodeDisplay.textContent = formatCode(state.activeCode);
    startStatsMonitor();
  }

  function showLobbyView() {
    els.callView.classList.remove('active');
    els.lobbyView.classList.add('active');
    stopStatsMonitor();
    clearIceTimeout();
    renderContactsList();
  }

  function showJoinError(msg) {
    els.joinError.textContent = msg;
    els.joinError.classList.remove('hidden');
  }

  function hideJoinError() {
    els.joinError.classList.add('hidden');
  }

  // --- Join & Leave Handlers ---
  async function handleJoinSubmit() {
    if (state.joining || state.activeCode) return;
    console.log('[MyFam] handleJoinSubmit triggered');
    hideJoinError();

    if (!els.codeInput) {
      console.error('[MyFam] codeInput element missing');
      return;
    }

    const rawCode = els.codeInput.value;
    const formatted = formatCode(rawCode);
    const cleanCode = formatted.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

    if (!/^[a-z0-9]{6}$/.test(cleanCode)) {
      showJoinError('Please enter a valid call code (e.g. 742-918)');
      return;
    }

    const name = (els.nameInput ? els.nameInput.value.trim() : '') || 'Family Member';
    state.userName = name;
    state.forceStealth = els.forceStealthCheckbox ? els.forceStealthCheckbox.checked : false;
    syncSavedName();

    state.joining = true;
    state.callGeneration++;
    // Unlock audio on the user's gesture, before permission prompts/network waits.
    prepareAudio().catch(err => console.warn('[Audio]', err));
    // Visual button feedback
    const originalBtnContent = els.joinBtn ? els.joinBtn.innerHTML : 'Start / Join Call';
    if (els.joinBtn) {
      els.joinBtn.disabled = true;
      els.joinBtn.innerHTML = '<span class="btn-spinner"></span> <span>Connecting...</span>';
    }

    function resetBtn() {
      resetJoinButton();
      if (els.joinBtn) {
        els.joinBtn.disabled = false;
        els.joinBtn.innerHTML = originalBtnContent;
      }
    }

    try {
      // Ensure WebSocket is open; reconnect if asleep
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
        console.log('[WS] Reconnecting socket before joining...');
        connectSignaling();
        let waitCount = 0;
        while ((!state.ws || state.ws.readyState !== WebSocket.OPEN) && waitCount < 30) {
          await new Promise(r => setTimeout(r, 100));
          waitCount++;
        }
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
          resetBtn();
          showJoinError('Connecting to server... Please tap Join again.');
          return;
        }
      }

      // Request camera/mic
      const mediaReady = await startLocalMedia();
      if (!mediaReady) {
        resetBtn();
        return;
      }

      // Send join message
      sendSignaling('join', {
        code: cleanCode,
        name: name
      });

      state.joinTimer = setTimeout(() => {
        if (!state.activeCode) { sendSignaling('leave'); failJoin('The server did not respond. Please try again.'); }
      }, 10000);
    } catch (err) {
      console.error('[MyFam] Join error:', err);
      failJoin('Join error: ' + (err.message || err));
    }
  }

  function resetJoinButton() {
    clearTimeout(state.joinTimer);
    state.joinTimer = null;
    state.joining = false;
    els.joinBtn.disabled = false;
    els.joinBtn.innerHTML = '<span>Start / Join Call</span>';
  }

  function failJoin(message) {
    state.callGeneration++;
    resetJoinButton();
    stopLocalMedia();
    showJoinError(message);
  }

  function cleanupPeer() {
    for (const peerId of Array.from(state.peers.keys())) {
      removePeer(peerId);
    }
    deactivateStealthMode(false, false);
    state.nextAudioTime = 0;
    updateRouteBadge('Waiting for family', 'checking');
    updateGridLayout();
  }

  function leaveCall() {
    state.callGeneration++;
    resetJoinButton();
    sendSignaling('leave');
    cleanupPeer();
    stopLocalMedia();
    state.activeCode = null;
    state.isAudioMuted = false;
    state.isVideoOff = false;
    state.isScreenSharing = false;
    els.toggleMicBtn.classList.remove('active-off');
    els.toggleMicBtn.querySelector('.icon-mic-on').classList.remove('hidden');
    els.toggleMicBtn.querySelector('.icon-mic-off').classList.add('hidden');
    els.shareScreenBtn.classList.remove('active-off');
    els.settingsModal.classList.add('hidden');
    if (state.audioContext) { state.audioContext.close().catch(() => {}); state.audioContext = null; state.audioModule = null; }
    showLobbyView();
  }

  // --- Event Listeners Setup ---
  function setupEventListeners() {
    els.codeInput.addEventListener('input', (e) => {
      const input = e.target;
      const prevVal = input.value;
      const prevCursor = input.selectionStart || 0;

      // Count alphanumeric characters before the cursor
      const charsBeforeCursor = prevVal.slice(0, prevCursor).replace(/[^a-zA-Z0-9]/g, '').length;

      const cleaned = prevVal.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6);
      const formatted = cleaned.length > 3 ? `${cleaned.slice(0, 3)}-${cleaned.slice(3)}` : cleaned;
      input.value = formatted;

      let newCursor = charsBeforeCursor;
      if (charsBeforeCursor > 3) {
        newCursor = charsBeforeCursor + 1;
      }
      newCursor = Math.min(newCursor, formatted.length);
      input.setSelectionRange(newCursor, newCursor);
    });

    els.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        const input = e.target;
        if (input.selectionStart === 4 && input.selectionEnd === 4 && input.value.charAt(3) === '-') {
          e.preventDefault();
          const cleaned = input.value.replace(/[^a-zA-Z0-9]/g, '');
          const updated = cleaned.slice(0, 2) + cleaned.slice(3);
          input.value = updated.length > 3 ? `${updated.slice(0, 3)}-${updated.slice(3)}` : updated;
          input.setSelectionRange(2, 2);
        }
      }
    });

    els.newCodeBtn.addEventListener('click', () => {
      els.codeInput.value = generateRandomCode();
    });

    els.presetSelect.addEventListener('change', (e) => {
      state.currentPreset = e.target.value;
      els.modalPresetSelect.value = e.target.value;
      storage.setItem('myfam_preset', state.currentPreset);
      applyBitrateConstraints();
    });

    if (els.nameInput) {
      els.nameInput.addEventListener('input', syncSavedName);
    }

    if (els.rememberNameCheckbox) {
      els.rememberNameCheckbox.addEventListener('change', syncSavedName);
    }

    els.modalPresetSelect.addEventListener('change', (e) => {
      state.currentPreset = e.target.value;
      els.presetSelect.value = e.target.value;
      storage.setItem('myfam_preset', state.currentPreset);
      applyBitrateConstraints();
    });

    els.modalStealthToggle.addEventListener('change', (e) => {
      toggleStealthPreference(e.target.checked);
    });

    // One-tap instant bypass button on the HUD
    if (els.quickStealthBtn) {
      els.quickStealthBtn.addEventListener('click', () => {
        const nextActive = !(state.isStealthActive || (state.peers.size === 0 && state.forceStealth));
        toggleStealthPreference(nextActive);
      });
    }

    if (els.joinBtn) {
      els.joinBtn.onclick = (e) => {
        e.preventDefault();
        handleJoinSubmit();
      };
    }

    if (els.joinForm) {
      els.joinForm.onsubmit = (e) => {
        e.preventDefault();
        handleJoinSubmit();
      };
    }

    function copyInviteLink(rawCode) {
      const code = formatCode(rawCode);
      const clean = code.replace(/[^a-zA-Z0-9]/g, '');
      if (clean.length !== 6) {
        showToast('Enter a 6-character code first.');
        return;
      }
      const url = `${window.location.origin}${window.location.pathname}#${clean}`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          showToast(`Invite link copied (${code})`);
        }).catch(() => {
          showToast(`Code: ${code}`);
        });
      } else {
        showToast(`Code: ${code}`);
      }
    }

    if (els.lobbyCopyBtn) {
      els.lobbyCopyBtn.addEventListener('click', () => {
        copyInviteLink(els.codeInput.value);
      });
    }

    els.copyInviteBtn.addEventListener('click', () => {
      copyInviteLink(state.activeCode);
    });

    els.addContactBtn.addEventListener('click', () => {
      openContactModal('Save Contact to Phone', '', els.codeInput.value || generateRandomCode());
    });

    els.closeContactModalBtn.addEventListener('click', () => {
      els.contactModal.classList.add('hidden');
    });

    els.contactModal.addEventListener('click', (e) => {
      if (e.target === els.contactModal) els.contactModal.classList.add('hidden');
    });

    els.saveContactBtn.addEventListener('click', () => {
      const name = els.contactNameInput.value.trim();
      const code = els.contactCodeInput.value.trim();
      if (!name) {
        alert('Please enter a name for this contact');
        return;
      }
      if (!code) {
        alert('Please enter a code');
        return;
      }

      addOrUpdateContact(name, code);
      els.contactModal.classList.add('hidden');

      if (state.activeCode && formatCode(code) === formatCode(state.activeCode)) {
        for (const peer of state.peers.values()) {
          peer.name = name;
          peer.nameEl.textContent = name;
          peer.initialsEl.textContent = name.charAt(0).toUpperCase();
        }
      }
    });

    els.toggleMicBtn.addEventListener('click', toggleMicrophone);
    els.toggleCamBtn.addEventListener('click', toggleCamera);
    els.flipCamBtn.addEventListener('click', flipCamera);
    els.shareScreenBtn.addEventListener('click', toggleScreenShare);
    els.hangupBtn.addEventListener('click', leaveCall);

    els.openSettingsBtn.addEventListener('click', () => {
      els.modalStealthToggle.checked = state.isStealthActive;
      els.settingsModal.classList.remove('hidden');
    });

    els.closeSettingsBtn.addEventListener('click', () => {
      els.settingsModal.classList.add('hidden');
    });

    els.applySettingsBtn.addEventListener('click', () => {
      els.settingsModal.classList.add('hidden');
    });

    els.settingsModal.addEventListener('click', (e) => {
      if (e.target === els.settingsModal) els.settingsModal.classList.add('hidden');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
