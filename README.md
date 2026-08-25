# 🏠 ESP32 Smart Home System (Blynk-Free Architecture)

A custom, high-performance Smart Home IoT system with **zero external cloud subscriptions** (no Blynk limits, no monthly fees). Everything runs on your own VPS or Linux server with real-time WebSocket communication.

---

## 🏗️ Architecture

```
┌─────────────┐       WebSocket (Port 3000)       ┌────────────────────────┐
│    ESP32    │ ────────────────────────────────► │  Node.js Relay Server  │
│ (Firmware)  │ ◄──────────────────────────────── │      (Your VPS)        │
└─────────────┘        Real-time Commands &       └────────────────────────┘
                          Sensor Telemetry                    ▲
                                                              │ WebSocket & Static HTTP
                                                              ▼
                                                   ┌────────────────────────┐
                                                   │ Web Control Dashboard  │
                                                   │  (Phone / PC / Tablet) │
                                                   └────────────────────────┘
```

---

## 🚀 Step 1: Deploy the Relay Server on Your VPS

### 1. Transfer the `server/` and dashboard files to your VPS:
```bash
scp -r /root/smart-home-dashboard user@YOUR_VPS_IP:/home/user/smart-home
```

### 2. SSH into your VPS & install dependencies:
```bash
cd /home/user/smart-home/server
npm install
```

### 3. Start the server (using PM2 for 24/7 background uptime):
```bash
npm install -g pm2
pm2 start server.js --name "esp32-smarthome"
pm2 startup
pm2 save
```

*The server will serve both the web dashboard on port `3000` and handle WebSocket connections.*

---

## ⚡ Step 2: Flash the ESP32 (Arduino IDE)

### 1. Install Required Libraries in Arduino IDE
Go to **Sketch ➔ Include Library ➔ Manage Libraries...** and install:
1. **`WebSockets`** by Markus Sattler (v2.4.0 or newer)
2. **`ArduinoJson`** by Benoît Blanchon (v6 or v7)
3. **`DHT sensor library`** by Adafruit
4. **`Adafruit Unified Sensor`**

### 2. Open the Firmware
Open [`esp32_firmware.ino`](file:///root/smart-home-dashboard/esp32_firmware/esp32_firmware.ino) in Arduino IDE.

### 3. Edit Configuration (Lines 22–27)
```cpp
const char* WIFI_SSID     = "Your_WiFi_Name";
const char* WIFI_PASSWORD = "Your_WiFi_Password";
const char* SERVER_HOST   = "YOUR_VPS_PUBLIC_IP"; // e.g. "123.45.67.89"
const int   SERVER_PORT   = 3000;
const char* SECRET_TOKEN  = "my-secret-esp32-token"; // Must match ESP32_TOKEN
```

### 4. Upload to ESP32
- Select Board: **ESP32 Dev Module**
- Select Port: (Your USB COM port)
- Click **Upload** ➔ Open **Serial Monitor** at **115200 baud**.
- You will see:
  ```
  [WiFi] Connected!
  [WS] Connected to Smart Home Server!
  ```

---

## 🌐 Step 3: Access Your Dashboard from Anywhere

1. Open your browser on any phone, laptop, or tablet:
   ```
   http://YOUR_VPS_PUBLIC_IP:3000
   ```
2. The top bar & settings page will immediately show:
   - **`ESP32 Online`** (Green glowing status dot)
   - Live DHT22 temperature & humidity readings
   - Live PIR motion sensor alerts
   - Instant relay switching with sub-50ms latency!
