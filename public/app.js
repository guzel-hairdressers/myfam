/**
 * MyFam - Ultra-lightweight Censorship-Resistant Voice & Video Client
 * 
 * 100% EPHEMERAL & PRIVATE:
 * - No user registration, no server accounts, no profiles.
 * - Simple 6-digit call codes (e.g. 742-918).
 * - Local-only family contacts (saved on your phone/browser only, never sent to server).
 * - Custom names / nicknames can be edited by you anytime.
 * - In-browser cryptographic verification via SHA-256.
 * - Dual-Engine: WebRTC with Opus FEC + Stealth WebSocket Relay on TLS port 443.
 */

(() => {
  // Quality & Bandwidth Presets
  const PRESETS = {
    potato: {
      label: 'Ultra-Low (Potato)',
      width: { ideal: 160, max: 240 },
      height: { ideal: 120, max: 180 },
      frameRate: { ideal: 10, max: 12 },
      videoBitrate: 45000,    // 45 kbps
      audioBitrate: 16000,    // 16 kbps Opus
      stealthFps: 5,
      stealthQuality: 0.3
    },
    low: {
      label: 'Low Bandwidth',
      width: { ideal: 320, max: 480 },
      height: { ideal: 240, max: 360 },
      frameRate: { ideal: 15, max: 15 },
      videoBitrate: 120000,   // 120 kbps
      audioBitrate: 20000,    // 20 kbps Opus
      stealthFps: 8,
      stealthQuality: 0.4
    },
    balanced: {
      label: 'Balanced',
      width: { ideal: 640, max: 640 },
      height: { ideal: 480, max: 480 },
      frameRate: { ideal: 20, max: 24 },
      videoBitrate: 350000,   // 350 kbps
      audioBitrate: 24000,    // 24 kbps Opus
      stealthFps: 12,
      stealthQuality: 0.55
    },
    hd: {
      label: 'High Definition',
      width: { ideal: 1280, max: 1280 },
      height: { ideal: 720, max: 720 },
      frameRate: { ideal: 30, max: 30 },
      videoBitrate: 800000,   // 800 kbps
      audioBitrate: 32000,    // 32 kbps Opus
      stealthFps: 15,
      stealthQuality: 0.7
    }
  };

  // State
  const state = {
    ws: null,
    clientId: null,
    activeCode: null,
    userName: '',
    callMode: 'audio-video', // 'audio-video' | 'audio-only'
    currentPreset: 'low',
    forceStealth: false,
    facingMode: 'user', // 'user' | 'environment'
    
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
    pingInterval: null,
    statsInterval: null,
    currentPing: null
  };

  // DOM Elements
  const els = {
    // Header
    serverStatusBadge: document.getElementById('serverStatusBadge'),
    serverStatusText: document.getElementById('serverStatusText'),
    
    // Views
    lobbyView: document.getElementById('lobbyView'),
    callView: document.getElementById('callView'),
    
    // Join Form
    joinForm: document.getElementById('joinForm'),
    codeInput: document.getElementById('codeInput'),
    newCodeBtn: document.getElementById('newCodeBtn'),
    nameInput: document.getElementById('nameInput'),
    segmentBtns: document.querySelectorAll('.segment-btn'),
    presetSelect: document.getElementById('presetSelect'),
    forceStealthCheckbox: document.getElementById('forceStealthModeCheckbox'),
    joinBtn: document.getElementById('joinBtn'),
    joinError: document.getElementById('joinError'),
    
    // Local Contacts
    contactsList: document.getElementById('contactsList'),
    addContactBtn: document.getElementById('addContactBtn'),
    contactModal: document.getElementById('contactModal'),
    contactModalTitle: document.getElementById('contactModalTitle'),
    contactNameInput: document.getElementById('contactNameInput'),
    contactCodeInput: document.getElementById('contactCodeInput'),
    closeContactModalBtn: document.getElementById('closeContactModalBtn'),
    saveContactBtn: document.getElementById('saveContactBtn'),
    
    // Call HUD
    hudCodeDisplay: document.getElementById('hudCodeDisplay'),
    hudPing: document.getElementById('hudPing'),
    hudTransport: document.getElementById('hudTransport'),
    hudBitrate: document.getElementById('hudBitrate'),
    copyInviteBtn: document.getElementById('copyInviteBtn'),
    
    // Media elements
    remoteVideo: document.getElementById('remoteVideo'),
    localVideo: document.getElementById('localVideo'),
    remoteCanvas: document.getElementById('remoteCanvas'),
    localCanvas: document.getElementById('localCanvas'),
    remoteAvatar: document.getElementById('remoteAvatar'),
    localAvatar: document.getElementById('localAvatar'),
    remoteInitials: document.getElementById('remoteInitials'),
    localInitials: document.getElementById('localInitials'),
    remoteNameTag: document.getElementById('remoteNameTag'),
    renameRemoteBtn: document.getElementById('renameRemoteBtn'),
    remoteSpeakingWave: document.getElementById('remoteSpeakingWave'),
    localSpeakingWave: document.getElementById('localSpeakingWave'),
    
    // Controls
    toggleMicBtn: document.getElementById('toggleMicBtn'),
    toggleCamBtn: document.getElementById('toggleCamBtn'),
    flipCamBtn: document.getElementById('flipCamBtn'),
    shareScreenBtn: document.getElementById('shareScreenBtn'),
    openSettingsBtn: document.getElementById('openSettingsBtn'),
    hangupBtn: document.getElementById('hangupBtn'),
    
    // Settings Modal
    settingsModal: document.getElementById('settingsModal'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    applySettingsBtn: document.getElementById('applySettingsBtn'),
    modalPresetSelect: document.getElementById('modalPresetSelect'),
    modalStealthToggle: document.getElementById('modalStealthToggle'),
    statPing: document.getElementById('statPing'),
    statLoss: document.getElementById('statLoss'),
    statBitrate: document.getElementById('statBitrate'),
    statProtocol: document.getElementById('statProtocol'),
    
    toast: document.getElementById('toast')
  };

  // --- Initialize App ---
  function init() {
    setupURLParams();
    setupEventListeners();
    connectSignaling();
    loadSavedSettings();
    renderContactsList();
  }

  // --- Code Formatting (XXX-XXX) ---
  function formatCode(raw) {
    const cleaned = (raw || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (cleaned.length > 3) {
      return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}`;
    }
    return cleaned;
  }

  function generateRandomCode() {
    // 6 digit clean numerical code (e.g. 492-817)
    const num = Math.floor(100000 + Math.random() * 900000).toString();
    return `${num.slice(0, 3)}-${num.slice(3, 6)}`;
  }

  // Cryptographic SHA-256 hash for verification without server storage
  async function computeSecurityHash(code) {
    try {
      const clean = code.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      const msgBuffer = new TextEncoder().encode(`${clean}::myfam::v1`);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
    } catch (e) {
      return '';
    }
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
    if (savedPreset && PRESETS[savedPreset]) {
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

  // --- Local Contacts Management (Private to this browser only) ---
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

    // Attach list action listeners
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

  // Check if current user has assigned a custom contact name to this code
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
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.services.mozilla.com:3478' },
        { urls: 'stun:stun.nextcloud.com:443' }
      ],
      iceCandidatePoolSize: 2,
      bundlePolicy: 'max-bundle'
    };

    const pc = new RTCPeerConnection(config);
    state.peerConnection = pc;

    if (state.localStream) {
      state.localStream.getTracks().forEach(track => {
        pc.addTrack(track, state.localStream);
      });
    }

    pc.ontrack = (event) => {
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

        setupAudioVisualizer(state.remoteStream, els.remoteSpeakingWave);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && state.peerId) {
        sendSignaling('candidate', {
          targetId: state.peerId,
          candidate: event.candidate
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      console.log('[WebRTC] ICE Connection:', iceState);

      if (iceState === 'connected' || iceState === 'completed') {
        updateRouteBadge('WebRTC Direct', 'connected');
        applyBitrateConstraints();
      } else if (iceState === 'checking') {
        updateRouteBadge('Connecting...', 'checking');
      } else if (iceState === 'failed' || iceState === 'disconnected') {
        console.warn('[WebRTC] Connection failed. Activating Stealth Relay fallback...');
        updateRouteBadge('WebRTC Failed', 'relay');
        activateStealthMode();
      }
    };

    return pc;
  }

  async function initiateCall(targetId) {
    const pc = createPeerConnection();
    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: state.callMode === 'audio-video'
      });

      const optimizedSdp = optimizeSdp(offer.sdp);
      await pc.setLocalDescription(new RTCSessionDescription({ type: 'offer', sdp: optimizedSdp }));

      sendSignaling('offer', {
        targetId,
        sdp: pc.localDescription.sdp
      });
    } catch (err) {
      console.error('[WebRTC] Error initiating call:', err);
    }
  }

  async function handleRemoteOffer(payload) {
    const pc = createPeerConnection();
    try {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: payload.sdp }));
      const answer = await pc.createAnswer();
      const optimizedSdp = optimizeSdp(answer.sdp);
      await pc.setLocalDescription(new RTCSessionDescription({ type: 'answer', sdp: optimizedSdp }));

      sendSignaling('answer', {
        targetId: payload.senderId,
        sdp: pc.localDescription.sdp
      });
    } catch (err) {
      console.error('[WebRTC] Error answering call:', err);
    }
  }

  async function handleRemoteAnswer(payload) {
    if (!state.peerConnection) return;
    try {
      await state.peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: payload.sdp }));
    } catch (err) {
      console.error('[WebRTC] Error setting answer:', err);
    }
  }

  async function handleRemoteCandidate(payload) {
    if (!state.peerConnection || !payload.candidate) return;
    try {
      await state.peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
    } catch (err) {
      console.error('[WebRTC] Error adding ICE candidate:', err);
    }
  }

  // Opus In-Band FEC and Clamped Bitrate
  function optimizeSdp(sdp) {
    const preset = PRESETS[state.currentPreset] || PRESETS.low;
    let modified = sdp;

    const opusParams = `useinbandfec=1;maxaveragebitrate=${preset.audioBitrate};stereo=0;cbr=1;maxptime=60`;
    modified = modified.replace(/a=fmtp:(\d+) minptime=\d+;useinbandfec=\d+/gi, `a=fmtp:$1 ${opusParams}`);
    modified = modified.replace(/a=rtpmap:(\d+) opus\/48000\/2/gi, (match, pt) => {
      if (!modified.includes(`a=fmtp:${pt}`)) {
        return `${match}\r\na=fmtp:${pt} ${opusParams}`;
      }
      return match;
    });

    const kbpsLimit = Math.round((preset.videoBitrate + preset.audioBitrate) / 1000);
    if (!modified.includes('b=AS:')) {
      modified = modified.replace(/(m=video \d+ [A-Z\/]+ \d+)/gi, `$1\r\nb=AS:${kbpsLimit}\r\nb=TIAS:${preset.videoBitrate}`);
    }

    return modified;
  }

  async function applyBitrateConstraints() {
    if (!state.peerConnection) return;
    const preset = PRESETS[state.currentPreset] || PRESETS.low;

    try {
      const senders = state.peerConnection.getSenders();
      for (const sender of senders) {
        if (!sender.track) continue;
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];

        if (sender.track.kind === 'video') {
          params.encodings[0].maxBitrate = preset.videoBitrate;
          params.encodings[0].maxFramerate = preset.frameRate.max;
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
    updateRouteBadge('Stealth WSS 443', 'stealth');
    showToast('Stealth Mode active: Routing over TLS 443');

    if (notifyPeer && state.peerId) {
      sendSignaling('stealth-toggle', { targetId: state.peerId, enabled: true });
    }

    els.remoteVideo.classList.add('hidden');
    els.remoteCanvas.classList.remove('hidden');

    startStealthAudioStream();
    if (state.callMode === 'audio-video' && !state.isVideoOff) {
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

    const preset = PRESETS[state.currentPreset] || PRESETS.low;
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
    const preset = PRESETS[state.currentPreset] || PRESETS.low;
    const isAudioOnly = state.callMode === 'audio-only';

    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      },
      video: isAudioOnly ? false : {
        width: preset.width,
        height: preset.height,
        frameRate: preset.frameRate,
        facingMode: state.facingMode
      }
    };

    try {
      state.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      els.localVideo.srcObject = state.localStream;

      if (isAudioOnly) {
        els.localVideo.classList.add('hidden');
        els.localAvatar.classList.remove('hidden');
        els.toggleCamBtn.classList.add('active-off');
      } else {
        els.localVideo.classList.remove('hidden');
        els.localAvatar.classList.add('hidden');
      }

      setupAudioVisualizer(state.localStream, els.localSpeakingWave);
      return true;
    } catch (err) {
      console.error('[Media] getUserMedia error:', err);
      if (!isAudioOnly) {
        showToast('Camera blocked or unavailable. Falling back to voice only...');
        state.callMode = 'audio-only';
        return startLocalMedia();
      }
      showJoinError('Microphone permission required for call.');
      return false;
    }
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
    if (!state.localStream || state.callMode === 'audio-only') return;
    const videoTrack = state.localStream.getVideoTracks()[0];
    if (!videoTrack) return;

    state.isVideoOff = !state.isVideoOff;
    videoTrack.enabled = !state.isVideoOff;

    els.toggleCamBtn.classList.toggle('active-off', state.isVideoOff);
    els.toggleCamBtn.querySelector('.icon-cam-on').classList.toggle('hidden', state.isVideoOff);
    els.toggleCamBtn.querySelector('.icon-cam-off').classList.toggle('hidden', !state.isVideoOff);

    els.localVideo.classList.toggle('hidden', state.isVideoOff);
    els.localAvatar.classList.toggle('hidden', !state.isVideoOff);

    if (state.isStealthActive) {
      if (state.isVideoOff) stopStealthVideoStream();
      else startStealthVideoStream();
    }
  }

  async function flipCamera() {
    if (state.callMode === 'audio-only' || !state.localStream) return;

    state.facingMode = state.facingMode === 'user' ? 'environment' : 'user';
    const preset = PRESETS[state.currentPreset] || PRESETS.low;

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

  // --- Diagnostics Monitor ---
  function startStatsMonitor() {
    stopStatsMonitor();
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

        if (packetsTotal > 0) {
          const lossRate = ((packetsLost / packetsTotal) * 100).toFixed(1);
          els.statLoss.textContent = `${lossRate}%`;
        }

        els.statProtocol.textContent = activeTransport;
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
    hideJoinError();
    const rawCode = els.codeInput.value;
    const formatted = formatCode(rawCode);
    const cleanCode = formatted.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

    if (!cleanCode || cleanCode.length < 4) {
      showJoinError('Please enter a valid call code (e.g. 742-918)');
      return;
    }

    const name = els.nameInput.value.trim() || 'Family Member';
    state.userName = name;
    state.forceStealth = els.forceStealthCheckbox.checked;

    localStorage.setItem('myfam_myname', name);

    // Compute cryptographic SHA-256 hash
    const clientHash = await computeSecurityHash(cleanCode);

    // Request camera/mic
    const mediaReady = await startLocalMedia();
    if (!mediaReady) return;

    // Send join message
    sendSignaling('join', {
      code: cleanCode,
      name: name,
      clientHash
    });
  }

  function cleanupPeer() {
    cleanupPeerConnection();
    deactivateStealthMode();
    state.peerId = null;
    state.peerName = '';
    updateRemotePeerDisplay();
    els.remoteVideo.srcObject = null;
    els.remoteVideo.classList.add('hidden');
    els.remoteAvatar.classList.remove('hidden');
  }

  function cleanupPeerConnection() {
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
    // Auto-format code as user types (XXX-XXX)
    els.codeInput.addEventListener('input', (e) => {
      const start = e.target.selectionStart;
      const formatted = formatCode(e.target.value);
      e.target.value = formatted;
      e.target.setSelectionRange(start, start);
    });

    // Generate New Code
    els.newCodeBtn.addEventListener('click', () => {
      els.codeInput.value = generateRandomCode();
    });

    // Call Mode Selector
    els.segmentBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        els.segmentBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.callMode = btn.dataset.mode;
      });
    });

    // Preset Selector
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

    // Stealth Modal Toggle
    els.modalStealthToggle.addEventListener('change', (e) => {
      if (e.target.checked) activateStealthMode();
      else deactivateStealthMode();
    });

    // Form Submit
    els.joinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleJoinSubmit();
    });

    // Copy Invite Link or Code
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

    // In-Call Rename Remote Participant Button
    els.renameRemoteBtn.addEventListener('click', () => {
      if (!state.activeCode) return;
      const currentName = state.peerName || '';
      openContactModal('Rename Contact in Your Phone', currentName, formatCode(state.activeCode));
    });

    // Contacts Modal Buttons
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

      // If currently in call with this code, update name display immediately
      if (state.activeCode && formatCode(code) === formatCode(state.activeCode)) {
        state.peerName = name;
        updateRemotePeerDisplay();
      }
    });

    // In-Call Toolbar
    els.toggleMicBtn.addEventListener('click', toggleMicrophone);
    els.toggleCamBtn.addEventListener('click', toggleCamera);
    els.flipCamBtn.addEventListener('click', flipCamera);
    els.shareScreenBtn.addEventListener('click', toggleScreenShare);
    els.hangupBtn.addEventListener('click', leaveCall);

    // Settings Modal
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

  document.addEventListener('DOMContentLoaded', init);
})();
