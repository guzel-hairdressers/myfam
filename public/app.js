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
    remoteStream: null,
    peerConnection: null,
    peerId: null,
    peerName: '',
    iceServers: [],
    
    isAudioMuted: false,
    isVideoOff: false,
    isScreenSharing: false,
    
    // Stealth fallback mode state
    isStealthActive: false,
    stealthAudioRecorder: null,
    stealthVideoTimer: null,
    stealthAudioContext: null,
    
    // Diagnostics
    lastBytesReceived: 0,
    lastStatsTime: 0,
    lastPacketsLost: 0,
    lastPacketsTotal: 0,
    pingInterval: null,
    statsInterval: null,
    currentPing: null,

    // WebRTC connection timeout monitor
    iceTimeoutTimer: null
  };

  // ICE Candidate Queue to prevent race conditions
  let pendingCandidates = [];

  // DOM Elements holder
  const els = {};

  function initElements() {
    els.serverStatusBadge = document.getElementById('serverStatusBadge');
    els.serverStatusText = document.getElementById('serverStatusText');
    els.lobbyView = document.getElementById('lobbyView');
    els.callView = document.getElementById('callView');
    els.joinForm = document.getElementById('joinForm');
    els.codeInput = document.getElementById('codeInput');
    els.newCodeBtn = document.getElementById('newCodeBtn');
    els.nameInput = document.getElementById('nameInput');
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
    els.remoteVideo = document.getElementById('remoteVideo');
    els.localVideo = document.getElementById('localVideo');
    els.remoteCanvas = document.getElementById('remoteCanvas');
    els.localCanvas = document.getElementById('localCanvas');
    els.remoteAvatar = document.getElementById('remoteAvatar');
    els.localAvatar = document.getElementById('localAvatar');
    els.remoteInitials = document.getElementById('remoteInitials');
    els.localInitials = document.getElementById('localInitials');
    els.remoteNameTag = document.getElementById('remoteNameTag');
    els.renameRemoteBtn = document.getElementById('renameRemoteBtn');
    els.remoteSpeakingWave = document.getElementById('remoteSpeakingWave');
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
    const num = Math.floor(100000 + Math.random() * 900000).toString();
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

  function loadSavedSettings() {
    const savedName = localStorage.getItem('myfam_myname');
    if (savedName) els.nameInput.value = savedName;

    const savedPreset = localStorage.getItem('myfam_preset');
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
      return JSON.parse(localStorage.getItem('myfam_local_contacts') || '[]');
    } catch (e) {
      return [];
    }
  }

  function saveLocalContacts(contacts) {
    localStorage.setItem('myfam_local_contacts', JSON.stringify(contacts));
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
      const item = document.createElement('div');
      item.className = 'contact-item';
      item.innerHTML = `
        <div class="contact-info">
          <span class="contact-name">${escapeHtml(contact.name)}</span>
          <span class="contact-code">${escapeHtml(contact.code)}</span>
        </div>
        <div class="contact-actions">
          <button type="button" class="btn-dial" data-code="${contact.code}" title="Call ${escapeHtml(contact.name)}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
            </svg>
            <span>Call</span>
          </button>
          <button type="button" class="btn-icon btn-rename" data-code="${contact.code}" data-name="${escapeHtml(contact.name)}" title="Rename in Contacts">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
          </button>
          <button type="button" class="btn-icon btn-icon-danger btn-del" data-code="${contact.code}" title="Delete">
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
    return div.innerHTML;
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
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    updateServerStatus('connecting', 'Connecting...');

    state.ws = new WebSocket(wsUrl);
    state.ws.binaryType = 'arraybuffer';

    state.ws.onopen = () => {
      updateServerStatus('connected', 'Ready');
      startPingHeartbeat();
    };

    state.ws.onclose = () => {
      updateServerStatus('error', 'Disconnected');
      stopPingHeartbeat();
      setTimeout(() => {
        if (!state.activeCode) connectSignaling();
      }, 3000);
    };

    state.ws.onerror = () => {
      updateServerStatus('error', 'Connection Error');
    };

    state.ws.onmessage = handleSignalingMessage;
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
        state.clientId = payload.clientId;
        state.activeCode = payload.code;
        state.iceServers = payload.iceServers || [];
        showCallView();

        if (payload.peers && payload.peers.length > 0) {
          const firstPeer = payload.peers[0];
          state.peerId = firstPeer.id;
          state.peerName = resolvePeerDisplayName(firstPeer.name, state.activeCode);
          updateRemotePeerDisplay();

          if (state.forceStealth) {
            activateStealthMode();
          } else {
            initiateCall(firstPeer.id);
          }
        }
        break;
      }

      case 'peer-joined': {
        state.peerId = payload.id;
        state.peerName = resolvePeerDisplayName(payload.name, state.activeCode);
        updateRemotePeerDisplay();
        showToast(`${state.peerName} joined the call`);

        // Pre-create PeerConnection so we are ready to receive offer & candidates
        if (!state.peerConnection) {
          createPeerConnection();
        }

        if (state.forceStealth) {
          activateStealthMode();
        }
        break;
      }

      case 'offer': {
        if (payload.senderId) {
          state.peerId = payload.senderId;
          state.peerName = resolvePeerDisplayName(payload.senderName, state.activeCode);
          updateRemotePeerDisplay();
          handleRemoteOffer(payload);
        }
        break;
      }

      case 'answer': {
        handleRemoteAnswer(payload);
        break;
      }

      case 'candidate': {
        handleRemoteCandidate(payload);
        break;
      }

      case 'stealth-toggle': {
        if (payload.enabled) {
          activateStealthMode(false);
        } else {
          deactivateStealthMode();
        }
        break;
      }

      case 'camera-toggle': {
        const remoteHasCam = payload.enabled;
        if (!state.isStealthActive) {
          els.remoteVideo.classList.toggle('hidden', !remoteHasCam);
          els.remoteAvatar.classList.toggle('hidden', remoteHasCam);
        }
        break;
      }

      case 'peer-left': {
        showToast(`${state.peerName || 'Participant'} left`);
        cleanupPeer();
        break;
      }

      case 'error': {
        showJoinError(payload.message || 'An error occurred');
        if (state.activeCode) {
          leaveCall();
        }
        break;
      }
    }
  }

  function resolvePeerDisplayName(serverGivenName, code) {
    const contactName = getContactNameForCode(code);
    if (contactName) return contactName;
    return serverGivenName || 'Family Member';
  }

  // --- WebRTC Core & SDP Optimizations ---

  function createPeerConnection() {
    cleanupPeerConnection();

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
    state.peerConnection = pc;

    // Attach local media tracks
    if (state.localStream) {
      state.localStream.getTracks().forEach(track => {
        pc.addTrack(track, state.localStream);
      });
    }

    // Handle remote tracks
    pc.ontrack = (event) => {
      console.log('[WebRTC] Remote track received:', event.track.kind);
      if (event.streams && event.streams[0]) {
        state.remoteStream = event.streams[0];
        els.remoteVideo.srcObject = state.remoteStream;

        const videoTrack = state.remoteStream.getVideoTracks()[0];
        if (videoTrack && videoTrack.enabled) {
          els.remoteVideo.classList.remove('hidden');
          els.remoteAvatar.classList.add('hidden');
        } else {
          els.remoteVideo.classList.add('hidden');
          els.remoteAvatar.classList.remove('hidden');
        }

        if (videoTrack) {
          videoTrack.onmute = () => {
            if (!state.isStealthActive) {
              els.remoteVideo.classList.add('hidden');
              els.remoteAvatar.classList.remove('hidden');
            }
          };
          videoTrack.onunmute = () => {
            if (!state.isStealthActive) {
              els.remoteVideo.classList.remove('hidden');
              els.remoteAvatar.classList.add('hidden');
            }
          };
        }

        // Trigger autoplay safely
        els.remoteVideo.play().catch(() => {
          // Retry with temporary mute for mobile browser autoplay policy
          els.remoteVideo.muted = true;
          els.remoteVideo.play().then(() => {
            setTimeout(() => els.remoteVideo.muted = false, 150);
          }).catch(() => {});
        });

        setupAudioVisualizer(state.remoteStream, els.remoteSpeakingWave);
      }
    };

    // Trickle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && state.peerId) {
        sendSignaling('candidate', {
          targetId: state.peerId,
          candidate: event.candidate
        });
      }
    };

    // Monitor ICE Connection State
    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      console.log('[WebRTC] ICE Connection State:', iceState);

      if (iceState === 'connected' || iceState === 'completed') {
        clearIceTimeout();
        updateRouteBadge('WebRTC Direct', 'connected');
        applyBitrateConstraints();
      } else if (iceState === 'checking') {
        updateRouteBadge('Connecting...', 'checking');
        startIceTimeout();
      } else if (iceState === 'failed' || iceState === 'disconnected') {
        clearIceTimeout();
        console.warn('[WebRTC] ICE failed. Switching to Stealth Relay (TLS 443)...');
        activateStealthMode();
      }
    };

    return pc;
  }

  // 6-Second Auto-Fallback: If carrier NAT or firewall blocks P2P UDP, auto-switch to port 443 tunnel
  function startIceTimeout() {
    clearIceTimeout();
    state.iceTimeoutTimer = setTimeout(() => {
      if (!state.peerConnection) return;
      const iceState = state.peerConnection.iceConnectionState;
      if (iceState === 'checking' || iceState === 'new') {
        console.warn('[WebRTC] Connection taking longer than 6s. Carrier NAT likely blocking UDP. Auto-activating Stealth Relay 443...');
        showToast('NAT/Firewall detected. Routing media over TLS port 443...');
        activateStealthMode();
      }
    }, 6000);
  }

  function clearIceTimeout() {
    if (state.iceTimeoutTimer) {
      clearTimeout(state.iceTimeoutTimer);
      state.iceTimeoutTimer = null;
    }
  }

  async function initiateCall(targetId) {
    const pc = createPeerConnection();
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
        console.warn('[WebRTC] Munged SDP rejected, using standard SDP:', sdpErr);
        await pc.setLocalDescription(offer);
        finalSdp = offer.sdp;
      }

      sendSignaling('offer', {
        targetId,
        sdp: finalSdp
      });
    } catch (err) {
      console.error('[WebRTC] Error initiating call:', err);
      activateStealthMode();
    }
  }

  async function handleRemoteOffer(payload) {
    const pc = createPeerConnection();
    try {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: payload.sdp }));
      
      // Flush any ICE candidates that arrived before the offer
      await flushPendingCandidates();

      const answer = await pc.createAnswer();
      let finalSdp = answer.sdp;
      try {
        finalSdp = optimizeSdp(answer.sdp);
        await pc.setLocalDescription(new RTCSessionDescription({ type: 'answer', sdp: finalSdp }));
      } catch (sdpErr) {
        console.warn('[WebRTC] Munged Answer rejected, using standard SDP:', sdpErr);
        await pc.setLocalDescription(answer);
        finalSdp = answer.sdp;
      }

      sendSignaling('answer', {
        targetId: payload.senderId,
        sdp: finalSdp
      });
    } catch (err) {
      console.error('[WebRTC] Error answering call:', err);
      activateStealthMode();
    }
  }

  async function handleRemoteAnswer(payload) {
    if (!state.peerConnection) return;
    try {
      await state.peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: payload.sdp }));
      // Flush candidates that arrived before the answer
      await flushPendingCandidates();
    } catch (err) {
      console.error('[WebRTC] Error setting answer:', err);
    }
  }

  // Handle incoming ICE candidate with queueing
  async function handleRemoteCandidate(payload) {
    if (!payload.candidate) return;
    const cand = new RTCIceCandidate(payload.candidate);

    if (!state.peerConnection || !state.peerConnection.remoteDescription) {
      // Queue candidate until remote description is set
      pendingCandidates.push(cand);
      return;
    }

    try {
      await state.peerConnection.addIceCandidate(cand);
    } catch (err) {
      console.warn('[WebRTC] Error adding ICE candidate:', err);
    }
  }

  async function flushPendingCandidates() {
    if (!state.peerConnection || !state.peerConnection.remoteDescription) return;
    while (pendingCandidates.length > 0) {
      const cand = pendingCandidates.shift();
      try {
        await state.peerConnection.addIceCandidate(cand);
      } catch (e) {
        console.warn('[WebRTC] Error adding queued candidate:', e);
      }
    }
  }

  // Opus In-Band FEC
  function optimizeSdp(sdp) {
    const preset = PRESETS[state.currentPreset] || PRESETS.low;
    let lines = sdp.split('\r\n');

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('a=fmtp:') && lines[i].includes('minptime=')) {
        lines[i] = `${lines[i]};useinbandfec=1;maxaveragebitrate=${preset.audioBitrate};stereo=0;cbr=1`;
      }
    }

    return lines.join('\r\n');
  }

  async function applyBitrateConstraints() {
    if (!state.peerConnection) return;
    const preset = getEffectivePreset();

    try {
      const senders = state.peerConnection.getSenders();
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

  // --- Dual-Engine: "Stealth Mode" (TLS Port 443 WebSocket Tunneling) ---
  function activateStealthMode(notifyPeer = true) {
    if (state.isStealthActive) return;
    state.isStealthActive = true;
    clearIceTimeout();
    updateRouteBadge('Stealth WSS 443', 'stealth');
    showToast('Stealth Tunnel active: Streaming via TLS port 443');

    if (notifyPeer && state.peerId) {
      sendSignaling('stealth-toggle', { targetId: state.peerId, enabled: true });
    }

    els.remoteVideo.classList.add('hidden');
    els.remoteCanvas.classList.remove('hidden');

    startStealthAudioStream();
    if (!state.isVideoOff) {
      startStealthVideoStream();
    }
  }

  function deactivateStealthMode() {
    if (!state.isStealthActive) return;
    state.isStealthActive = false;
    stopStealthAudioStream();
    stopStealthVideoStream();

    els.remoteCanvas.classList.add('hidden');
    els.remoteVideo.classList.remove('hidden');
    updateRouteBadge('WebRTC Direct', 'connected');
  }

  function startStealthAudioStream() {
    stopStealthAudioStream();
    if (!state.localStream) return;

    const audioTrack = state.localStream.getAudioTracks()[0];
    if (!audioTrack) return;

    try {
      const audioStream = new MediaStream([audioTrack]);
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
        ? 'audio/webm;codecs=opus' 
        : 'audio/webm';

      state.stealthAudioRecorder = new MediaRecorder(audioStream, {
        mimeType,
        audioBitsPerSecond: 16000
      });

      state.stealthAudioRecorder.ondataavailable = async (e) => {
        if (e.data && e.data.size > 0 && state.ws && state.ws.readyState === WebSocket.OPEN) {
          const buffer = await e.data.arrayBuffer();
          const packet = new Uint8Array(buffer.byteLength + 1);
          packet[0] = 0x01; // Audio
          packet.set(new Uint8Array(buffer), 1);
          state.ws.send(packet.buffer);
        }
      };

      state.stealthAudioRecorder.start(200);
    } catch (e) {
      console.error('[Stealth] Audio recorder error:', e);
    }
  }

  function stopStealthAudioStream() {
    if (state.stealthAudioRecorder && state.stealthAudioRecorder.state !== 'inactive') {
      try { state.stealthAudioRecorder.stop(); } catch (e) {}
      state.stealthAudioRecorder = null;
    }
  }

  function startStealthVideoStream() {
    stopStealthVideoStream();
    if (!state.localStream || state.isVideoOff) return;

    const preset = getEffectivePreset();
    const intervalMs = Math.round(1000 / preset.stealthFps);

    const canvas = document.createElement('canvas');
    canvas.width = preset.width.ideal;
    canvas.height = preset.height.ideal;
    const ctx = canvas.getContext('2d');

    state.stealthVideoTimer = setInterval(() => {
      if (!els.localVideo.videoWidth || state.isVideoOff) return;
      ctx.drawImage(els.localVideo, 0, 0, canvas.width, canvas.height);

      canvas.toBlob((blob) => {
        if (!blob || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
        blob.arrayBuffer().then((buffer) => {
          const packet = new Uint8Array(buffer.byteLength + 1);
          packet[0] = 0x02; // Video
          packet.set(new Uint8Array(buffer), 1);
          state.ws.send(packet.buffer);
        });
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

  async function playStealthAudioChunk(arrayBuffer) {
    if (!state.stealthAudioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      state.stealthAudioContext = new AudioCtx();
    }
    
    if (state.stealthAudioContext.state === 'suspended') {
      await state.stealthAudioContext.resume();
    }

    try {
      const audioBuffer = await state.stealthAudioContext.decodeAudioData(arrayBuffer);
      const source = state.stealthAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(state.stealthAudioContext.destination);
      source.start();

      triggerSpeakingAnimation(els.remoteSpeakingWave);
    } catch (e) {}
  }

  function renderStealthVideoFrame(arrayBuffer) {
    const blob = new Blob([arrayBuffer], { type: 'image/jpeg' });
    const imgUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = els.remoteCanvas;
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(imgUrl);

      els.remoteAvatar.classList.add('hidden');
      els.remoteCanvas.classList.remove('hidden');
    };
    img.src = imgUrl;
  }

  // --- Audio Visualizer ---
  function setupAudioVisualizer(stream, targetElement) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      function checkVolume() {
        if (!state.activeCode) {
          audioCtx.close();
          return;
        }
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
        const avg = sum / bufferLength;

        if (avg > 18) {
          targetElement.parentElement.parentElement.classList.add('is-speaking');
        } else {
          targetElement.parentElement.parentElement.classList.remove('is-speaking');
        }
        requestAnimationFrame(checkVolume);
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
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showJoinError('Media access requires HTTPS or browser permission. Please check your browser address has https://');
      return false;
    }

    const preset = getEffectivePreset();

    // Tier 1: Try requested video & audio with mobile-safe ideal constraints
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: { facingMode: state.facingMode, width: { ideal: preset.width.ideal }, height: { ideal: preset.height.ideal } }
      });
    } catch (e1) {
      console.warn('[Media] Tier 1 camera failed, trying simple video:', e1);
      try {
        // Tier 2: Simplest video constraints
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      } catch (e2) {
        console.warn('[Media] Simple video failed, falling back to audio only:', e2);
        showToast('Camera not accessible. Voice only mode.');
        state.isVideoOff = true;
      }
    }

    // Tier 3: Audio only if video failed
    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        state.isVideoOff = true;
      } catch (err) {
        console.error('[Media] Audio getUserMedia error:', err);
        showJoinError('Microphone permission required. Please allow microphone in browser settings.');
        return false;
      }
    }

    state.localStream = stream;
    els.localVideo.srcObject = state.localStream;

    const hasVideo = stream.getVideoTracks().length > 0;
    if (!hasVideo || state.isVideoOff) {
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

    if (state.peerId) {
      sendSignaling('camera-toggle', { targetId: state.peerId, enabled: !state.isVideoOff });
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

      if (state.peerConnection) {
        const sender = state.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(newTrack);
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

      if (state.peerConnection) {
        const sender = state.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(screenTrack);
      }

      state.isScreenSharing = true;
      els.shareScreenBtn.classList.add('active-off');
      showToast('Sharing screen');
    } catch (e) {}
  }

  // --- Diagnostics Monitor & Dynamic Auto-Adaptive Quality ---
  function startStatsMonitor() {
    stopStatsMonitor();
    state.lastPacketsLost = 0;
    state.lastPacketsTotal = 0;
    state.goodNetworkCycles = 0;

    state.statsInterval = setInterval(async () => {
      if (!state.peerConnection) {
        if (state.isStealthActive) {
          els.hudBitrate.textContent = 'Relay 443';
          els.statBitrate.textContent = 'Active';
          els.statProtocol.textContent = 'WSS TLS';
        }
        return;
      }

      try {
        const stats = await state.peerConnection.getStats();
        let bytesRecv = 0;
        let packetsLost = 0;
        let packetsTotal = 0;
        let activeTransport = 'WebRTC Direct';

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

        // Auto-Adaptive Quality Engine:
        // Automatically steps quality up/down in real-time based on jitter, loss, and latency
        if (state.currentPreset === 'auto' && !state.isVideoOff) {
          const currentTierIdx = QUALITY_TIERS.indexOf(state.activeTier);

          // Downscale trigger: packet loss > 5% or ping > 380ms
          const isStruggling = deltaLossPct > 5 || (state.currentPing !== null && state.currentPing > 380);
          // Upscale trigger: clean network (loss < 1% or no loss) and latency < 160ms
          const isHealthy = deltaLossPct < 1 && (state.currentPing === null || state.currentPing < 160);

          if (isStruggling) {
            state.goodNetworkCycles = 0;
            if (currentTierIdx > 0) {
              state.activeTier = QUALITY_TIERS[currentTierIdx - 1];
              console.log(`[Adaptive Quality] Network congestion detected (loss: ${deltaLossPct.toFixed(1)}%, ping: ${state.currentPing}ms). Stepping down to: ${state.activeTier}`);
              applyBitrateConstraints();
              showToast(`Network slow: Adapted quality to ${PRESETS[state.activeTier].label}`);
            }
          } else if (isHealthy) {
            state.goodNetworkCycles = (state.goodNetworkCycles || 0) + 1;
            // Require 5 consecutive clean cycles (10 seconds) before upgrading
            if (state.goodNetworkCycles >= 5) {
              state.goodNetworkCycles = 0;
              if (currentTierIdx < QUALITY_TIERS.length - 1) {
                state.activeTier = QUALITY_TIERS[currentTierIdx + 1];
                console.log(`[Adaptive Quality] Sustained clean network. Stepping up to: ${state.activeTier}`);
                applyBitrateConstraints();
                showToast(`Network stable: Upgraded quality to ${PRESETS[state.activeTier].label}`);
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

  function updateRemotePeerDisplay() {
    if (state.peerName) {
      els.remoteNameTag.textContent = state.peerName;
      els.remoteInitials.textContent = state.peerName.charAt(0).toUpperCase();
    } else {
      els.remoteNameTag.textContent = 'Waiting for them to connect...';
      els.remoteInitials.textContent = '?';
    }
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
    console.log('[MyFam] handleJoinSubmit triggered');
    hideJoinError();

    if (!els.codeInput) {
      console.error('[MyFam] codeInput element missing');
      return;
    }

    const rawCode = els.codeInput.value;
    const formatted = formatCode(rawCode);
    const cleanCode = formatted.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

    if (!cleanCode || cleanCode.length < 4) {
      showJoinError('Please enter a valid call code (e.g. 742-918)');
      return;
    }

    const name = (els.nameInput ? els.nameInput.value.trim() : '') || 'Family Member';
    state.userName = name;
    state.forceStealth = els.forceStealthCheckbox ? els.forceStealthCheckbox.checked : false;
    localStorage.setItem('myfam_myname', name);

    // Visual button feedback
    const originalBtnContent = els.joinBtn ? els.joinBtn.innerHTML : 'Start / Join Call';
    if (els.joinBtn) {
      els.joinBtn.disabled = true;
      els.joinBtn.innerHTML = '<span class="btn-spinner"></span> <span>Connecting...</span>';
    }

    function resetBtn() {
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

      // Safety timeout: reset button after 6 seconds if no response
      setTimeout(() => {
        if (!state.activeCode) resetBtn();
      }, 6000);
    } catch (err) {
      console.error('[MyFam] Join error:', err);
      resetBtn();
      showJoinError('Join error: ' + (err.message || err));
    }
  }

  function cleanupPeer() {
    clearIceTimeout();
    cleanupPeerConnection();
    deactivateStealthMode();
    state.peerId = null;
    state.peerName = '';
    pendingCandidates = [];
    updateRemotePeerDisplay();
    els.remoteVideo.srcObject = null;
    els.remoteVideo.classList.add('hidden');
    els.remoteAvatar.classList.remove('hidden');
  }

  function cleanupPeerConnection() {
    clearIceTimeout();
    if (state.peerConnection) {
      state.peerConnection.ontrack = null;
      state.peerConnection.onicecandidate = null;
      state.peerConnection.oniceconnectionstatechange = null;
      state.peerConnection.close();
      state.peerConnection = null;
    }
  }

  function leaveCall() {
    sendSignaling('leave');
    cleanupPeer();
    stopLocalMedia();
    state.activeCode = null;
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
      localStorage.setItem('myfam_preset', state.currentPreset);
      applyBitrateConstraints();
    });

    els.modalPresetSelect.addEventListener('change', (e) => {
      state.currentPreset = e.target.value;
      els.presetSelect.value = e.target.value;
      localStorage.setItem('myfam_preset', state.currentPreset);
      applyBitrateConstraints();
    });

    els.modalStealthToggle.addEventListener('change', (e) => {
      if (e.target.checked) activateStealthMode();
      else deactivateStealthMode();
    });

    // One-tap instant bypass button on the HUD
    if (els.quickStealthBtn) {
      els.quickStealthBtn.addEventListener('click', () => {
        if (!state.isStealthActive) activateStealthMode();
        else deactivateStealthMode();
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

    els.copyInviteBtn.addEventListener('click', () => {
      const code = formatCode(state.activeCode);
      const url = `${window.location.origin}${window.location.pathname}#${code.replace('-', '')}`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          showToast(`Link copied for code: ${code}`);
        });
      } else {
        showToast(`Code: ${code}`);
      }
    });

    els.renameRemoteBtn.addEventListener('click', () => {
      if (!state.activeCode) return;
      const currentName = state.peerName || '';
      openContactModal('Rename Contact in Your Phone', currentName, formatCode(state.activeCode));
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
        state.peerName = name;
        updateRemotePeerDisplay();
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
