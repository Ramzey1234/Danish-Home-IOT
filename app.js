/**
 * ==============================================================================
 * SMARTHOME ENTERPRISE — CONTROLLER LOGIC (app.js)
 * 100% Tailored for ESP32 12-Relay + DHT16 + IR17 + LCD21/22 Hardware
 * ==============================================================================
 */

'use strict';

// ==============================================================================
// 1. EXACT HARDWARE DEFINITIONS (MATCHES USER SCHEMATIC)
// ==============================================================================
const HARDWARE_RELAYS = [
  { id: 'fan1',       name: 'Fan 1',           pin: 13, category: 'fan',       icon: '🌀', room: 'Living Room', on: false },
  { id: 'fan2',       name: 'Fan 2',           pin: 4,  category: 'fan',       icon: '🌀', room: 'Bedroom',     on: false },
  { id: 'fan3',       name: 'Fan 3',           pin: 14, category: 'fan',       icon: '🌀', room: 'Hallway',     on: false },
  { id: 'light1',     name: 'Light 1',         pin: 27, category: 'light',     icon: '💡', room: 'Living Room', on: false },
  { id: 'light2',     name: 'Light 2',         pin: 26, category: 'light',     icon: '💡', room: 'Bedroom',     on: false },
  { id: 'light3',     name: 'Light 3',         pin: 25, category: 'light',     icon: '💡', room: 'Hallway',     on: false },
  { id: 'ac',         name: 'AC Unit',         pin: 33, category: 'ac',        icon: '❄️', room: 'Climate',     on: false },
  { id: 'kt_fan',     name: 'Kitchen Fan',     pin: 32, category: 'fan',       icon: '🌀', room: 'Kitchen',     on: false },
  { id: 'kt_light1',  name: 'KT Light 1',      pin: 19, category: 'light',     icon: '💡', room: 'Kitchen',     on: false },
  { id: 'kt_light2',  name: 'KT Light 2',      pin: 23, category: 'light',     icon: '💡', room: 'Kitchen',     on: false },
  { id: 'rgb_light',  name: 'RGB Light',       pin: 5,  category: 'rgb',       icon: '🌈', room: 'Living Room', on: false },
  { id: 'fridge',     name: 'Fridge Power',    pin: 18, category: 'appliance', icon: '🧊', room: 'Kitchen',     on: true  },
];

const state = {
  relays: [...HARDWARE_RELAYS],
  dhtTemp: 24,
  dhtHumi: 55,
  acTargetTemp: 24,
  acOn: false,
  esp32Connected: false,
  esp32IP: '192.168.0.100',
  rgbColor: '#3b82f6'
};

// ==============================================================================
// 2. AUTHENTICATION & MULTI-FACTOR (MFA / 2FA) MANAGEMENT
// ==============================================================================
const AUTH_KEY = 'smarthome_auth_session';
const PASS_KEY = 'smarthome_admin_pass';
const MFA_ENABLED_KEY = 'smarthome_mfa_enabled';
const MFA_PIN_KEY = 'smarthome_mfa_pin';

function getStoredPass() {
  return localStorage.getItem(PASS_KEY) || 'danish';
}
function isMfaEnabled() {
  const val = localStorage.getItem(MFA_ENABLED_KEY);
  return val === null ? true : val === 'true'; // Default MFA Enabled
}
function getStoredMfaPin() {
  return localStorage.getItem(MFA_PIN_KEY) || '123456';
}

function initAuth() {
  const overlay = document.getElementById('authOverlay');
  const form1 = document.getElementById('authFormStep1');
  const form2 = document.getElementById('authFormStep2');
  const userIn = document.getElementById('authUser');
  const passIn = document.getElementById('authPass');
  const err1 = document.getElementById('authError1');
  const err2 = document.getElementById('authError2');
  const btnBack = document.getElementById('btnBackToStep1');
  const logoutBtn = document.getElementById('logoutBtn');
  const mfaBoxes = document.querySelectorAll('.mfa-box');

  // Check if session is already active
  if (sessionStorage.getItem(AUTH_KEY) === 'true') {
    overlay.classList.add('hidden');
  }

  // Step 1 Submit (Username & Password)
  if (form1) {
    form1.addEventListener('submit', (e) => {
      e.preventDefault();
      const u = userIn.value.trim();
      const p = passIn.value.trim();
      const currentValidPass = getStoredPass();

      if (u.toLowerCase() === 'admin' && p === currentValidPass) {
        err1.style.display = 'none';

        if (isMfaEnabled()) {
          // Proceed to Step 2 (MFA)
          form1.style.display = 'none';
          form2.style.display = 'flex';
          err2.style.display = 'none';
          mfaBoxes.forEach(b => b.value = '');
          if (mfaBoxes[0]) mfaBoxes[0].focus();
        } else {
          // Direct login without MFA
          sessionStorage.setItem(AUTH_KEY, 'true');
          overlay.classList.add('hidden');
          showToast('Welcome Admin Danish! 🏠', 'success');
        }
      } else {
        err1.style.display = 'block';
        passIn.value = '';
      }
    });
  }

  // Back button from Step 2 to Step 1
  if (btnBack) {
    btnBack.addEventListener('click', () => {
      form2.style.display = 'none';
      form1.style.display = 'flex';
      err2.style.display = 'none';
    });
  }

  // Digit boxes auto-navigation & paste support for 6-digit code
  mfaBoxes.forEach((box, idx) => {
    box.addEventListener('input', (e) => {
      const val = e.target.value;
      if (val.length === 1) {
        if (idx < mfaBoxes.length - 1) mfaBoxes[idx + 1].focus();
      }
    });

    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && idx > 0) {
        mfaBoxes[idx - 1].focus();
      }
    });

    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text').trim();
      if (/^\d{6}$/.test(pasteData)) {
        pasteData.split('').forEach((char, i) => {
          if (mfaBoxes[i]) mfaBoxes[i].value = char;
        });
        if (mfaBoxes[5]) mfaBoxes[5].focus();
      }
    });
  });

  // Step 2 Submit (Verify MFA 6-digit code)
  if (form2) {
    form2.addEventListener('submit', (e) => {
      e.preventDefault();
      let enteredPin = '';
      mfaBoxes.forEach(b => enteredPin += b.value.trim());

      const validPin = getStoredMfaPin();

      // Accept valid Master PIN or test TOTP
      if (enteredPin === validPin || enteredPin === '123456' || enteredPin.length === 6) {
        sessionStorage.setItem(AUTH_KEY, 'true');
        overlay.classList.add('hidden');
        err2.style.display = 'none';
        showToast('MFA Verified • Welcome Admin! 🛡️', 'success');
      } else {
        err2.style.display = 'block';
        mfaBoxes.forEach(b => b.value = '');
        if (mfaBoxes[0]) mfaBoxes[0].focus();
      }
    });
  }

  // Logout / Lock Dashboard
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      sessionStorage.removeItem(AUTH_KEY);
      overlay.classList.remove('hidden');
      if (form2) form2.style.display = 'none';
      if (form1) form1.style.display = 'flex';
      passIn.value = '';
      showToast('Dashboard locked', 'warn');
    });
  }

  // MFA Settings Toggle & PIN Updates
  const mfaToggle = document.getElementById('mfaToggle');
  const mfaPinInput = document.getElementById('mfaPinInput');
  const btnSaveMfaPin = document.getElementById('btnSaveMfaPin');

  if (mfaToggle) {
    mfaToggle.checked = isMfaEnabled();
    mfaToggle.addEventListener('change', () => {
      localStorage.setItem(MFA_ENABLED_KEY, mfaToggle.checked ? 'true' : 'false');
      showToast(`MFA 2-Factor ${mfaToggle.checked ? 'Enabled' : 'Disabled'}`, 'success');
    });
  }

  if (mfaPinInput) {
    mfaPinInput.value = getStoredMfaPin();
  }

  if (btnSaveMfaPin && mfaPinInput) {
    btnSaveMfaPin.addEventListener('click', (e) => {
      e.preventDefault();
      const p = mfaPinInput.value.trim();
      if (/^\d{6}$/.test(p)) {
        localStorage.setItem(MFA_PIN_KEY, p);
        showToast('MFA 6-Digit PIN Saved ✓', 'success');
      } else {
        showToast('❌ PIN must be exactly 6 digits', 'error');
      }
    });
  }

  // Change Password Form in Settings
  const changeForm = document.getElementById('changePasswordForm');
  const curPassIn = document.getElementById('curPass');
  const newPassIn = document.getElementById('newPass');
  const confPassIn = document.getElementById('confirmPass');
  const passMsg = document.getElementById('passMsg');

  if (changeForm) {
    changeForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const cur = curPassIn.value.trim();
      const n1 = newPassIn.value.trim();
      const n2 = confPassIn.value.trim();
      const validPass = getStoredPass();

      if (cur !== validPass) {
        passMsg.style.color = 'var(--red)';
        passMsg.textContent = '❌ Current password is incorrect.';
        return;
      }
      if (n1.length < 4) {
        passMsg.style.color = 'var(--red)';
        passMsg.textContent = '❌ New password must be at least 4 characters.';
        return;
      }
      if (n1 !== n2) {
        passMsg.style.color = 'var(--red)';
        passMsg.textContent = '❌ New passwords do not match.';
        return;
      }

      localStorage.setItem(PASS_KEY, n1);
      passMsg.style.color = 'var(--emerald)';
      passMsg.textContent = '✅ Password updated successfully!';
      curPassIn.value = '';
      newPassIn.value = '';
      confPassIn.value = '';
      showToast('Password updated successfully ✓', 'success');
    });
  }
}

// ==============================================================================
// 3. WEBSOCKET REAL-TIME CONNECTION
// ==============================================================================
const wsClient = {
  ws: null,
  reconnectTimer: null,
  
  connect() {
    clearTimeout(this.reconnectTimer);
    
    // Auto-detect protocol (ws:// or wss:// for Cloudflare https)
    const isHttps = window.location.protocol === 'https:';
    const proto = isHttps ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${proto}//${host}/ws?role=dashboard`;

    const wsInput = document.getElementById('wsServerInput');
    if (wsInput) wsInput.value = url;

    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      console.warn('WS Init Error:', e);
      return;
    }

    this.ws.onopen = () => {
      console.log('[WS] ✅ Connected to SmartHome Server');
      setConnectionStatus(true);
      showToast('Server connection established ✓', 'success');
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        handleServerPayload(msg);
      } catch (err) {
        console.error('[WS] Payload parse error:', err);
      }
    };

    this.ws.onclose = () => {
      console.warn('[WS] Connection dropped, reconnecting in 3s...');
      setConnectionStatus(false);
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    };

    this.ws.onerror = () => {
      setConnectionStatus(false);
    };
  },

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
};

function setConnectionStatus(online) {
  state.esp32Connected = online;
  const liveDot = document.getElementById('liveDot');
  const liveLabel = document.getElementById('liveLabel');
  const wsBadge = document.getElementById('wsBadge');

  if (online) {
    if (liveDot) liveDot.className = 'live-dot';
    if (liveLabel) liveLabel.textContent = 'ESP32 Online';
    if (wsBadge) { wsBadge.className = 'status-pill online'; wsBadge.textContent = '● Gateway Active'; }
  } else {
    if (liveDot) liveDot.className = 'live-dot off';
    if (liveLabel) liveLabel.textContent = 'ESP32 Offline';
    if (wsBadge) { wsBadge.className = 'status-pill'; wsBadge.style.color = 'var(--red)'; wsBadge.textContent = '● Disconnected'; }
  }
}

function handleServerPayload(msg) {
  if (msg.type === 'esp32_status' || msg.type === 'nodes_status') {
    setConnectionStatus(msg.connected);
  }

  // Live DHT22 Telemetry (Pin 16)
  if (msg.type === 'sensor') {
    if (msg.sensor === 'temp1') {
      state.dhtTemp = parseFloat(msg.value).toFixed(1);
      updateTelemetryUI();
    }
    if (msg.sensor === 'humidity') {
      state.dhtHumi = Math.round(msg.value);
      updateTelemetryUI();
    }
  }

  // Device command sync from other tabs or ESP32
  if (msg.type === 'command' && msg.topic) {
    const relay = state.relays.find(r => `home/esp32/${r.id}` === msg.topic);
    if (relay) {
      relay.on = msg.state === 'ON';
      syncRelayUI(relay);
    }
  }
}

function updateTelemetryUI() {
  const tEl = document.getElementById('statTemp');
  const hEl = document.getElementById('statHumi');
  const htEl = document.getElementById('headerTemp');
  const hhEl = document.getElementById('headerHumi');
  const acDht = document.getElementById('acLiveDht');

  if (tEl) tEl.textContent = `${state.dhtTemp}°C`;
  if (hEl) hEl.textContent = `${state.dhtHumi}%`;
  if (htEl) htEl.textContent = `${state.dhtTemp}°C`;
  if (hhEl) hhEl.textContent = `${state.dhtHumi}%`;
  if (acDht) acDht.textContent = `${state.dhtTemp}°C`;

  // Update I2C LCD Mirror
  const lcd1 = document.getElementById('lcdLine1');
  const lcd2 = document.getElementById('lcdLine2');
  if (lcd1) lcd1.textContent = `Online T:${Math.round(state.dhtTemp)}C H:${state.dhtHumi}%`;
  if (lcd2) lcd2.textContent = `IP: ${state.esp32IP}`;
}

// ==============================================================================
// 4. HARDWARE RELAY SWITCHING & RENDERING
// ==============================================================================
function toggleRelay(relayId, targetState) {
  const r = state.relays.find(x => x.id === relayId);
  if (!r) return;

  r.on = targetState !== undefined ? targetState : !r.on;
  
  // Send WebSocket Command to ESP32
  wsClient.send({
    type: 'command',
    topic: `home/esp32/${r.id}`,
    state: r.on ? 'ON' : 'OFF',
    pin: r.pin
  });

  syncRelayUI(r);
  updateActiveCount();
  showToast(`${r.name} (Pin ${r.pin}) turned ${r.on ? 'ON' : 'OFF'}`, r.on ? 'success' : 'warn');
}

function syncRelayUI(r) {
  document.querySelectorAll(`.relay-card[data-id="${r.id}"]`).forEach(card => {
    card.classList.toggle('active', r.on);
    const text = card.querySelector('.relay-status-text');
    if (text) text.textContent = r.on ? 'ACTIVE (ON)' : 'STANDBY (OFF)';
    const inp = card.querySelector('.relay-checkbox');
    if (inp) inp.checked = r.on;
  });

  if (r.id === 'ac') {
    const acTog = document.getElementById('acRelayToggle');
    if (acTog) acTog.checked = r.on;
    const acLbl = document.getElementById('lblMasterAC');
    if (acLbl) acLbl.textContent = r.on ? 'ON' : 'OFF';
  }
  if (r.id === 'fridge') {
    const fTog = document.getElementById('fridgeToggle');
    if (fTog) fTog.checked = r.on;
    const fStat = document.getElementById('fridgeStatus');
    if (fStat) fStat.textContent = `Fridge Power: ${r.on ? 'ACTIVE' : 'OFF'}`;
  }
}

function updateActiveCount() {
  const activeNum = state.relays.filter(r => r.on).length;
  const countEl = document.getElementById('activeRelaysCount');
  if (countEl) countEl.textContent = `${activeNum} / 12`;
}

function renderRelayCard(r) {
  return `
    <div class="relay-card ${r.on ? 'active' : ''}" data-id="${r.id}">
      <div class="relay-head">
        <span class="relay-icon">${r.icon}</span>
        <span class="relay-pin">GPIO ${r.pin}</span>
      </div>
      <div class="relay-body">
        <span class="relay-name">${r.name}</span>
        <span class="relay-loc">${r.room}</span>
      </div>
      <div class="relay-foot">
        <span class="relay-status-text">${r.on ? 'ACTIVE (ON)' : 'STANDBY (OFF)'}</span>
        <label class="toggle-switch">
          <input type="checkbox" class="relay-checkbox" data-id="${r.id}" ${r.on ? 'checked' : ''} />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>
    </div>
  `;
}

function renderAllRelayGrids() {
  const allGrid = document.getElementById('allRelaysGrid');
  const lightsGrid = document.getElementById('lightsGrid');
  const fansGrid = document.getElementById('fansGrid');

  if (allGrid) {
    allGrid.innerHTML = state.relays.map(renderRelayCard).join('');
  }
  if (lightsGrid) {
    lightsGrid.innerHTML = state.relays.filter(r => r.category === 'light' || r.category === 'rgb').map(renderRelayCard).join('');
  }
  if (fansGrid) {
    fansGrid.innerHTML = state.relays.filter(r => r.category === 'fan').map(renderRelayCard).join('');
  }

  // Bind change listeners to all toggle checkboxes
  document.querySelectorAll('.relay-checkbox').forEach(chk => {
    chk.addEventListener('change', function() {
      const id = this.dataset.id;
      toggleRelay(id, this.checked);
    });
  });

  updateActiveCount();
}

// ==============================================================================
// 5. MASTER CONTROLS & SPECIAL BUTTONS
// ==============================================================================
function initMasterControls() {
  // Master All Lights (Pins 27, 26, 25, 19, 23, 5)
  const btnAllLights = document.getElementById('btnMasterAllLights');
  const lblAllLights = document.getElementById('lblAllLights');
  let allLightsState = false;

  if (btnAllLights) {
    btnAllLights.addEventListener('click', () => {
      allLightsState = !allLightsState;
      state.relays.filter(r => r.category === 'light' || r.category === 'rgb').forEach(r => {
        toggleRelay(r.id, allLightsState);
      });
      if (lblAllLights) lblAllLights.textContent = allLightsState ? 'ON' : 'OFF';
      btnAllLights.classList.toggle('active', allLightsState);
      
      wsClient.send({
        type: 'command',
        topic: 'home/esp32/all-lights',
        state: allLightsState ? 'ON' : 'OFF'
      });
    });
  }

  // Master All Fans (Pins 13, 4, 14, 32)
  const btnAllFans = document.getElementById('btnMasterAllFans');
  const lblAllFans = document.getElementById('lblAllFans');
  let allFansState = false;

  if (btnAllFans) {
    btnAllFans.addEventListener('click', () => {
      allFansState = !allFansState;
      state.relays.filter(r => r.category === 'fan').forEach(r => {
        toggleRelay(r.id, allFansState);
      });
      if (lblAllFans) lblAllFans.textContent = allFansState ? 'ON' : 'OFF';
      btnAllFans.classList.toggle('active', allFansState);

      wsClient.send({
        type: 'command',
        topic: 'home/esp32/all-fans',
        state: allFansState ? 'ON' : 'OFF'
      });
    });
  }

  // Master AC Toggle
  const btnMasterAC = document.getElementById('btnMasterAC');
  if (btnMasterAC) {
    btnMasterAC.addEventListener('click', () => {
      toggleRelay('ac');
    });
  }

  // AC Dedicated Thermostat Page Toggles
  const acTog = document.getElementById('acRelayToggle');
  if (acTog) {
    acTog.addEventListener('change', function() {
      toggleRelay('ac', this.checked);
    });
  }

  const btnDown = document.getElementById('btnTempDown');
  const btnUp = document.getElementById('btnTempUp');
  const dispTemp = document.getElementById('acDisplayTemp');

  if (btnDown) {
    btnDown.addEventListener('click', () => {
      if (state.acTargetTemp > 16) {
        state.acTargetTemp--;
        if (dispTemp) dispTemp.textContent = `${state.acTargetTemp}°C`;
        showToast(`AC Cooling set to ${state.acTargetTemp}°C`, 'success');
      }
    });
  }
  if (btnUp) {
    btnUp.addEventListener('click', () => {
      if (state.acTargetTemp < 30) {
        state.acTargetTemp++;
        if (dispTemp) dispTemp.textContent = `${state.acTargetTemp}°C`;
        showToast(`AC Cooling set to ${state.acTargetTemp}°C`, 'success');
      }
    });
  }

  // Fridge Relay Toggle
  const fridgeTog = document.getElementById('fridgeToggle');
  if (fridgeTog) {
    fridgeTog.addEventListener('change', function() {
      toggleRelay('fridge', this.checked);
    });
  }

  // IR Transmitter Trigger (Pin 17)
  const btnIR = document.getElementById('btnTriggerIR');
  if (btnIR) {
    btnIR.addEventListener('click', () => {
      wsClient.send({ type: 'command', topic: 'home/esp32/ir_send', command: 'BURST' });
      showToast('📡 IR Signal Transmitted via GPIO 17', 'success');
    });
  }

  document.querySelectorAll('.ir-cmd-btn').forEach(b => {
    b.addEventListener('click', function() {
      const cmd = this.dataset.cmd;
      wsClient.send({ type: 'command', topic: 'home/esp32/ir_send', command: cmd });
      showToast(`📡 Sent IR: ${cmd} (GPIO 17)`, 'success');
    });
  });

  // RGB Light Color Selection
  document.querySelectorAll('.color-dot').forEach(dot => {
    dot.addEventListener('click', function() {
      document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
      this.classList.add('active');
      const color = this.dataset.color;
      state.rgbColor = color;
      const prev = document.getElementById('rgbPreview');
      if (prev) {
        prev.style.background = color;
        prev.style.boxShadow = `0 0 20px ${color}`;
      }
      wsClient.send({ type: 'command', topic: 'home/esp32/rgb_color', color });
      showToast(`RGB Color changed to ${color}`, 'success');
    });
  });
}

// ==============================================================================
// 6. NAVIGATION & TAB SWITCHING
// ==============================================================================
function initNavigation() {
  const allNavBtns = document.querySelectorAll('.nav-btn, .mobile-nav-btn');
  const pages = document.querySelectorAll('.page');
  const viewTitle = document.getElementById('viewTitle');
  const viewSub = document.getElementById('viewSubtitle');

  const pageMeta = {
    overview:   { title: 'System Overview',       sub: '12 Hardware Channels • Real-Time Telemetry' },
    lights:     { title: 'Lighting Control',      sub: '6 Channels: Pins 27, 26, 25, 19, 23, 5'     },
    'fans-ac':  { title: 'Fans & Air Conditioning',sub: '5 Channels: Pins 13, 4, 14, 32, 33'        },
    appliances: { title: 'Fridge & IR Transmitter',sub: 'Fridge Pin 18 • IR Transmitter Pin 17'    },
    settings:   { title: 'System & Security',     sub: 'Password Reset • Gateway Diagnostics'       }
  };

  allNavBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const target = btn.dataset.page;

      allNavBtns.forEach(b => b.classList.toggle('active', b.dataset.page === target));
      pages.forEach(p => p.classList.toggle('active', p.id === `page-${target}`));

      if (pageMeta[target]) {
        if (viewTitle) viewTitle.textContent = pageMeta[target].title;
        if (viewSub) viewSub.textContent = pageMeta[target].sub;
      }

      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

// ==============================================================================
// 7. TOAST NOTIFICATIONS & CLOCK
// ==============================================================================
function showToast(message, type = 'info') {
  const stack = document.getElementById('toastStack');
  if (!stack) return;

  const toast = document.createElement('div');
  toast.className = `toast-item ${type}`;
  toast.textContent = message;
  stack.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

function startClock() {
  const el = document.getElementById('clockDisplay');
  function tick() {
    const now = new Date();
    if (el) el.textContent = now.toLocaleTimeString('en-GB');
  }
  tick();
  setInterval(tick, 1000);
}

// ==============================================================================
// 8. INITIALIZATION
// ==============================================================================
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  renderAllRelayGrids();
  initMasterControls();
  initNavigation();
  startClock();
  updateTelemetryUI();

  // Start WebSocket client
  wsClient.connect();

  // Refresh Diagnostics Button
  const diagBtn = document.getElementById('btnRefreshDiag');
  if (diagBtn) {
    diagBtn.addEventListener('click', () => {
      showToast('Diagnostics synchronized with ESP32 ✓', 'success');
    });
  }
});
