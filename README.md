# MyFam — Lightweight Cross-Border Calling App

A barebones, ultra-lightweight web-based voice and video call application engineered to connect family members across heavily censored or restricted network environments (**China's Great Firewall, Russia's RKN/DPI throttling, Europe, and the US**) **without requiring a VPN**.

---

## Key Features

- **No VPN Required**: Operates over standard TLS port 443. Traffic is indistinguishable from standard HTTPS web browsing.
- **Zero Registration & No Profiles**: Connect by simply sharing an ephemeral 6-digit call code (e.g. `742-918`). No passwords, no phone numbers, no emails.
- **100% Ephemeral (Zero Server Storage)**: No database (no SQLite, Postgres, or Redis). Call rooms exist strictly in volatile RAM and are wiped instantly when empty. No IP logs or call metadata.
- **Local Private Contacts**: Rename and save family members (e.g. "Mom", "Dad") into your phone’s address book. Stored strictly in your phone's browser `localStorage`, never sent to the server.
- **Zero Blocked CDNs**: 100% self-contained frontend. No Google Fonts, unpkg, cdnjs, or tracking scripts that get blocked or cause timeouts in China/Russia.
- **Opus Voice with In-Band FEC**: Tuned to 16–24 kbps with Forward Error Correction enabled (`useinbandfec=1`). Automatically reconstructs dropped audio packets on lossy cross-border mobile connections.
- **Bandwidth Clamping Presets**:
  - *Ultra-Low / Potato*: ~50 kbps video / 16 kbps voice (designed for 2G/3G or throttled networks).
  - *Low Bandwidth*: ~120 kbps (Recommended default).
  - *Balanced*: ~350 kbps.
  - *HD*: ~800 kbps.
- **Dual-Engine Architecture (WebRTC + Stealth WebSocket Relay)**:
  - *Primary*: WebRTC with hardware acceleration and sub-100ms latency.
  - *Fallback*: "Stealth Mode" pipes audio/video chunks directly through the active WebSocket connection on TLS port 443 if a firewall drops UDP traffic.

---

## Running Locally

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Start the server**:
   ```bash
   npm start
   ```

3. Open `http://localhost:3000` in your browser.

---

## Free & Cheap Hosting Options

### Option 1: 100% Free Hosting (Zero Credit Card)

1. **Render (Free Tier)**
   - Sign up at [render.com](https://render.com) using GitHub or Google (no credit card required).
   - Create a **New Web Service**, connect this repository.
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Render will give you a free `https://your-app.onrender.com` URL with automatic SSL port 443!

2. **Koyeb (Free Tier)**
   - Sign up at [koyeb.com](https://www.koyeb.com).
   - Deploy using the provided `Dockerfile` in the **Frankfurt** region (ideal for Russia/Europe transit).

3. **Hugging Face Spaces (Free Docker)**
   - Create a free Space on [huggingface.co/spaces](https://huggingface.co/spaces).
   - Select the **Docker** SDK.
   - Push this repo, and it will run 24/7 with a public HTTPS URL.

---

### Option 2: Ultra-Cheap VPS ($1 – $3 / month) — *The Most Immune to Censorship*

Having your own dedicated IP and domain is virtually immune to censorship because firewalls do not block private IP addresses serving standard TLS on port 443.

- **RackNerd / CloudCone ($10 – $12 / year → ~$1/month)**: Choose **Los Angeles** or **San Jose** for direct subsea fiber routes to China Telecom/Unicom and clean transit to Europe.
- **Hetzner Cloud (~€3.30 / month)**: Choose **Falkenstein (Germany)** or **Helsinki (Finland)** for ultra-low latency to Russia (25–35ms) and pristine European/US routing.
- **Aeza (~€1.50 – €3 / month)**: Popular in Russian tech communities; accepts Russian and international cards with zero RKN blocking.

#### 1-Command VPS Deployment with Docker:
```bash
# Clone and launch
docker compose up -d
```

---

## Project Structure

```
MyFam/
├── public/
│   ├── index.html       # Mobile-first calling interface
│   ├── style.css        # Dark theme, zero external font dependencies
│   └── app.js           # WebRTC, Opus FEC, Stealth WSS tunnel, contacts
├── server.js            # In-memory ephemeral signaling & static server
├── Dockerfile           # Alpine Node (~50MB) container
├── docker-compose.yml   # Multi-container setup with optional Caddy SSL
├── render.yaml          # Render free-tier deployment config
├── package.json         # Single dependency: `ws`
└── test/
    └── test_server.js   # Automated test suite
```
