/**
 * ESP32 Smart Home — WebSocket Relay Server
 * ------------------------------------------
 * Bridges the ESP32 device and the web dashboard.
 * ESP32 connects as a client → server relays to dashboard and vice versa.
 *
 * Protocol (JSON messages):
 *   ESP32 → Server:  { type: "sensor", pin: ..., value: ..., ... }
 *   Dashboard→Server:{ type: "command", device: ..., action: ..., value: ... }
 *   Server → all:    same payload, forwarded transparently
 */

const WebSocket = require('ws');
const http      = require('http');
const path      = require('path');
const fs        = require('fs');

// ── Config ──────────────────────────────────────────────────────────────────
const PORT        = process.env.PORT || 3000;
const DASHBOARD_DIR = path.join(__dirname, '..');   // serves the dashboard files
const SECRET_TOKEN  = process.env.ESP32_TOKEN || 'my-secret-esp32-token';

// ── HTTP Server (serves dashboard + WebSocket upgrade) ────────────────────────
const httpServer = http.createServer((req, res) => {
  // Simple static file server for the dashboard
  let filePath = path.join(DASHBOARD_DIR, req.url === '/' ? 'index.html' : req.url);
  const ext  = path.extname(filePath);
  const mime = { '.html':'text/html', '.css':'text/css', '.js':'application/javascript' };

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' });
    res.end(data);
  });
});

// ── WebSocket Server ──────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ server: httpServer });

// Track connected clients by role
const clients = {
  esp32:     null,   // Only one ESP32 device
  dashboards: new Set(), // Multiple browser dashboards allowed
};

// Last known state (so new dashboards get current state immediately)
const deviceState = {
  connected: false,
  sensors:   {},
  devices:   {},
};

function broadcast(data, exclude = null) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function sendToDashboards(data) {
  const msg = JSON.stringify(data);
  clients.dashboards.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

function sendToESP32(data) {
  if (clients.esp32 && clients.esp32.readyState === WebSocket.OPEN) {
    clients.esp32.send(JSON.stringify(data));
    return true;
  }
  return false;
}

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  const url = new URL(req.url, `http://localhost`);
  const role  = url.searchParams.get('role');   // 'esp32' or 'dashboard'
  const token = url.searchParams.get('token');  // auth token

  console.log(`[${new Date().toISOString()}] New connection — role: ${role}, IP: ${ip}`);

  // ── Authenticate ESP32 ────────────────────────────────────────────────────
  if (role === 'esp32') {
    if (token !== SECRET_TOKEN) {
      console.warn(`[AUTH] ESP32 rejected — wrong token from ${ip}`);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid token' }));
      ws.close();
      return;
    }

    // Disconnect old ESP32 if reconnecting
    if (clients.esp32) {
      console.log('[ESP32] Previous ESP32 disconnected, replacing...');
      clients.esp32.close();
    }

    clients.esp32 = ws;
    deviceState.connected = true;
    console.log(`[ESP32] ✅ ESP32 connected from ${ip}`);

    // Notify all dashboards
    sendToDashboards({ type: 'esp32_status', connected: true, ip });

    // Send current command state to ESP32 on reconnect
    if (Object.keys(deviceState.devices).length > 0) {
      ws.send(JSON.stringify({ type: 'sync', devices: deviceState.devices }));
    }

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        console.log(`[ESP32 → Server] ${JSON.stringify(msg)}`);

        // Update server-side state cache
        if (msg.type === 'sensor') {
          deviceState.sensors[msg.sensor] = msg.value;
        }

        // Forward to all connected dashboards
        sendToDashboards(msg);
      } catch (e) {
        console.error('[ESP32] Parse error:', e.message);
      }
    });

    ws.on('close', () => {
      console.log('[ESP32] ❌ Disconnected');
      clients.esp32 = null;
      deviceState.connected = false;
      sendToDashboards({ type: 'esp32_status', connected: false });
    });

    ws.on('error', (err) => console.error('[ESP32] Error:', err.message));
    return;
  }

  // ── Dashboard client ──────────────────────────────────────────────────────
  clients.dashboards.add(ws);
  console.log(`[Dashboard] ✅ Dashboard connected — total: ${clients.dashboards.size}`);

  // Send current state immediately to new dashboard
  ws.send(JSON.stringify({
    type:      'init',
    esp32:     { connected: deviceState.connected },
    sensors:   deviceState.sensors,
    devices:   deviceState.devices,
  }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      console.log(`[Dashboard → Server] ${JSON.stringify(msg)}`);

      // Cache the command state
      if (msg.type === 'command' && msg.device) {
        deviceState.devices[msg.device] = msg;
      }

      // Forward command to ESP32
      const delivered = sendToESP32(msg);
      if (!delivered) {
        ws.send(JSON.stringify({ type: 'error', message: 'ESP32 not connected' }));
      }

      // Also echo to other dashboards (sync multi-tab)
      clients.dashboards.forEach(d => {
        if (d !== ws && d.readyState === WebSocket.OPEN) d.send(JSON.stringify(msg));
      });
    } catch (e) {
      console.error('[Dashboard] Parse error:', e.message);
    }
  });

  ws.on('close', () => {
    clients.dashboards.delete(ws);
    console.log(`[Dashboard] ❌ Disconnected — remaining: ${clients.dashboards.size}`);
  });

  ws.on('error', (err) => console.error('[Dashboard] Error:', err.message));
});

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   ESP32 Smart Home — Relay Server        ║');
  console.log(`║   Running on port ${PORT}                   ║`);
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
  console.log(`📡 Dashboard:  http://YOUR_VPS_IP:${PORT}`);
  console.log(`🔌 ESP32 WS:   ws://YOUR_VPS_IP:${PORT}?role=esp32&token=${SECRET_TOKEN}`);
  console.log(`💻 Browser WS: ws://YOUR_VPS_IP:${PORT}?role=dashboard`);
  console.log('');
});

process.on('SIGINT', () => { console.log('\nShutting down...'); process.exit(); });
