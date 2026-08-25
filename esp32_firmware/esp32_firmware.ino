/*
 * ====================================================================================
 * ESP32 Smart Home Controller Firmware (Custom Hardware Pinout & I2C LCD)
 * ====================================================================================
 *
 * Hardware Configuration (from schematic):
 *   - I2C LCD 16x2 / 20x4: SDA -> GPIO 21, SCL -> GPIO 22, VCC -> 5V, GND -> GND
 *   - IR Transmitter:      GPIO 17
 *   - Temp & Humidity:     GPIO 16 (DHT11 / DHT22)
 *   - Relays (12 Channels):
 *       1.  Fan 1:           GPIO 13
 *       2.  Fan 2:           GPIO 4
 *       3.  Fan 3:           GPIO 14
 *       4.  Light 1:         GPIO 27
 *       5.  Light 2:         GPIO 26
 *       6.  Light 3:         GPIO 25
 *       7.  AC:              GPIO 33
 *       8.  Kitchen Fan:     GPIO 32
 *       9.  Kitchen Light 1: GPIO 19
 *       10. Kitchen Light 2: GPIO 23
 *       11. RGB Light:       GPIO 5
 *       12. Fridge:          GPIO 18
 *
 * Required Arduino Libraries:
 *   1. "WebSockets" by Markus Sattler (v2.4.0+)
 *   2. "ArduinoJson" by Benoît Blanchon (v6.x or v7.x)
 *   3. "DHT sensor library" by Adafruit
 *   4. "LiquidCrystal I2C" by Frank de Brabander (or Marco Schwartz)
 *   5. "Adafruit Unified Sensor"
 */

#include <WiFi.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

// ====================================================================================
// 1. CONFIGURATION
// ====================================================================================
const char* WIFI_SSID     = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD"; // Note: WiFi default from sheet is 12345678

// Server Details — local LAN IP (ESP32 connects directly over your home Wi-Fi)
const char* SERVER_HOST   = "192.168.0.100";
const int   SERVER_PORT   = 8888;
const char* SECRET_TOKEN  = "my-secret-esp32-token";

// Unique Device Identity (Change this for each ESP32 you flash!)
// e.g. "esp32_main", "esp32_bedroom", "esp32_kitchen", "esp32_sensors"
const char* DEVICE_ID     = "esp32_main";
const char* DEVICE_NAME   = "Main Controller";

// ====================================================================================
// 2. HARDWARE PIN DEFINITIONS (EXACT AS PER NOTE)
// ====================================================================================
// I2C LCD Pins
#define PIN_LCD_SDA            21
#define PIN_LCD_SCL            22

// IR Transmitter
#define PIN_IR_TRANSMITTER     17

// Temperature & Humidity (DHT)
#define PIN_DHT                16
#define DHTTYPE                DHT22 // Change to DHT11 if using blue DHT11

// 12 Relay Channels
#define PIN_FAN_1              13
#define PIN_FAN_2              4
#define PIN_FAN_3              14
#define PIN_LIGHT_1            27
#define PIN_LIGHT_2            26
#define PIN_LIGHT_3            25
#define PIN_AC                 33
#define PIN_KT_FAN             32
#define PIN_KT_LIGHT_1         19
#define PIN_KT_LIGHT_2         23
#define PIN_RGB_LIGHT          5
#define PIN_FRIDGE             18

// Relay active level (Relays are typically ACTIVE LOW)
#define RELAY_ON  LOW
#define RELAY_OFF HIGH

// ====================================================================================
// 3. OBJECTS & GLOBALS
// ====================================================================================
LiquidCrystal_I2C lcd(0x27, 16, 2); // Change address to 0x3F if 0x27 doesn't show text
WebSocketsClient webSocket;
DHT dht(PIN_DHT, DHTTYPE);

unsigned long lastSensorReadTime = 0;
const unsigned long SENSOR_INTERVAL = 3000;

float currentTemp = 0.0;
float currentHumi = 0.0;
bool isWsConnected = false;

// ====================================================================================
// 4. RELAY CONTROL HELPERS
// ====================================================================================
void setRelay(int pin, bool state) {
  digitalWrite(pin, state ? RELAY_ON : RELAY_OFF);
}

void setupPins() {
  int relayPins[] = {
    PIN_FAN_1, PIN_FAN_2, PIN_FAN_3,
    PIN_LIGHT_1, PIN_LIGHT_2, PIN_LIGHT_3,
    PIN_AC, PIN_KT_FAN, PIN_KT_LIGHT_1,
    PIN_KT_LIGHT_2, PIN_RGB_LIGHT, PIN_FRIDGE
  };

  for (int pin : relayPins) {
    pinMode(pin, OUTPUT);
    digitalWrite(pin, RELAY_OFF); // Start with all OFF
  }

  pinMode(PIN_IR_TRANSMITTER, OUTPUT);
  digitalWrite(PIN_IR_TRANSMITTER, LOW);
}

// ====================================================================================
// 5. LCD DISPLAY UPDATE
// ====================================================================================
void updateLCD() {
  lcd.setCursor(0, 0);
  if (isWsConnected) {
    lcd.print("Online ");
  } else {
    lcd.print("Offline");
  }
  lcd.print(" T:");
  lcd.print((int)currentTemp);
  lcd.print("C H:");
  lcd.print((int)currentHumi);
  lcd.print("% ");

  lcd.setCursor(0, 1);
  lcd.print("IP:");
  lcd.print(WiFi.localIP().toString().substring(0, 13));
}

// ====================================================================================
// 6. COMMAND DISPATCHER
// ====================================================================================
void handleCommand(JsonDocument& doc) {
  const char* topic  = doc["topic"] | "";
  const char* stateStr = doc["state"] | "";
  bool isOn = (strcmp(stateStr, "ON") == 0 || strcmp(stateStr, "1") == 0 || strcmp(stateStr, "ARM") == 0);

  Serial.printf("[CMD] Topic: %s | State: %s\n", topic, stateStr);

  // Relay mapping
  if (strcmp(topic, "home/esp32/fan1") == 0)         { setRelay(PIN_FAN_1, isOn); }
  else if (strcmp(topic, "home/esp32/fan2") == 0)    { setRelay(PIN_FAN_2, isOn); }
  else if (strcmp(topic, "home/esp32/fan3") == 0)    { setRelay(PIN_FAN_3, isOn); }
  else if (strcmp(topic, "home/esp32/light1") == 0)  { setRelay(PIN_LIGHT_1, isOn); }
  else if (strcmp(topic, "home/esp32/light2") == 0)  { setRelay(PIN_LIGHT_2, isOn); }
  else if (strcmp(topic, "home/esp32/light3") == 0)  { setRelay(PIN_LIGHT_3, isOn); }
  else if (strcmp(topic, "home/esp32/ac") == 0)      { setRelay(PIN_AC, isOn); }
  else if (strcmp(topic, "home/esp32/kt_fan") == 0)  { setRelay(PIN_KT_FAN, isOn); }
  else if (strcmp(topic, "home/esp32/kt_light1") == 0){ setRelay(PIN_KT_LIGHT_1, isOn); }
  else if (strcmp(topic, "home/esp32/kt_light2") == 0){ setRelay(PIN_KT_LIGHT_2, isOn); }
  else if (strcmp(topic, "home/esp32/rgb_light") == 0){ setRelay(PIN_RGB_LIGHT, isOn); }
  else if (strcmp(topic, "home/esp32/fridge") == 0)  { setRelay(PIN_FRIDGE, isOn); }
  
  // Master Controls
  else if (strcmp(topic, "home/esp32/all-lights") == 0) {
    setRelay(PIN_LIGHT_1, isOn);
    setRelay(PIN_LIGHT_2, isOn);
    setRelay(PIN_LIGHT_3, isOn);
    setRelay(PIN_KT_LIGHT_1, isOn);
    setRelay(PIN_KT_LIGHT_2, isOn);
    setRelay(PIN_RGB_LIGHT, isOn);
  }
  else if (strcmp(topic, "home/esp32/all-fans") == 0) {
    setRelay(PIN_FAN_1, isOn);
    setRelay(PIN_FAN_2, isOn);
    setRelay(PIN_FAN_3, isOn);
    setRelay(PIN_KT_FAN, isOn);
  }

  // IR Transmitter Trigger (Pin 17)
  else if (strcmp(topic, "home/esp32/ir_send") == 0) {
    digitalWrite(PIN_IR_TRANSMITTER, HIGH);
    delay(50);
    digitalWrite(PIN_IR_TRANSMITTER, LOW);
  }
}

// ====================================================================================
// 7. WEBSOCKET HANDLER
// ====================================================================================
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      Serial.println("[WS] Disconnected from server");
      isWsConnected = false;
      updateLCD();
      break;

    case WStype_CONNECTED:
      Serial.println("[WS] Connected to Server!");
      isWsConnected = true;
      updateLCD();
      break;

    case WStype_TEXT: {
      StaticJsonDocument<512> doc;
      DeserializationError err = deserializeJson(doc, payload);
      if (!err) {
        handleCommand(doc);
      }
      break;
    }
    default:
      break;
  }
}

// ====================================================
// 8. SENSOR TELEMETRY
// ====================================================
void readAndSendSensors() {
  float h = dht.readHumidity();
  float t = dht.readTemperature();

  if (!isnan(t) && !isnan(h)) {
    currentTemp = t;
    currentHumi = h;
    updateLCD();

    StaticJsonDocument<256> doc1;
    doc1["type"] = "sensor";
    doc1["sensor"] = "temp1";
    doc1["value"] = currentTemp;
    String out1;
    serializeJson(doc1, out1);
    webSocket.sendTXT(out1);

    StaticJsonDocument<256> doc2;
    doc2["type"] = "sensor";
    doc2["sensor"] = "humidity";
    doc2["value"] = currentHumi;
    String out2;
    serializeJson(doc2, out2);
    webSocket.sendTXT(out2);
  }
}

// ====================================================================================
// 9. SETUP & LOOP
// ====================================================================================
void setup() {
  Serial.begin(115200);

  // Initialize I2C LCD on GPIO 21 (SDA) & GPIO 22 (SCL)
  Wire.begin(PIN_LCD_SDA, PIN_LCD_SCL);
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("SmartHome ESP32");
  lcd.setCursor(0, 1);
  lcd.print("Connecting WiFi");

  setupPins();
  dht.begin();

  // Connect to Wi-Fi
  Serial.printf("Connecting to %s...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 30) {
    delay(500);
    Serial.print(".");
    retries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected! IP: " + WiFi.localIP().toString());
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("WiFi Connected!");
    lcd.setCursor(0, 1);
    lcd.print(WiFi.localIP());
  } else {
    Serial.println("\n[WiFi] Failed to connect.");
    lcd.clear();
    lcd.print("WiFi Failed");
  }

  delay(1500);

  // Start WebSocket client to VPS (registers with unique device ID)
  String path = String("/ws?role=esp32&token=") + SECRET_TOKEN + "&device_id=" + DEVICE_ID + "&name=" + DEVICE_NAME;
  webSocket.begin(SERVER_HOST, SERVER_PORT, path.c_str());
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(3000);
}

void loop() {
  webSocket.loop();

  unsigned long now = millis();
  if (now - lastSensorReadTime >= SENSOR_INTERVAL) {
    lastSensorReadTime = now;
    if (WiFi.status() == WL_CONNECTED) {
      readAndSendSensors();
    }
  }
}
