/*
  ==========================================================
   SMART COOP PREDATOR DETERRENT — ESP32 Firmware (v4)
   ENHANCED: Full 8x8 LED Matrix + RCWL-0516 Radar Support
  ==========================================================
  
  Hardware Setup:
    - RCWL-0516 Radar        -> GPIO 4  (3.3V OUT signal)
    - PIR Motion Sensor      -> GPIO 27 (3.3V OUT signal)
  - Push Button            -> GPIO 32 (INPUT_PULLUP with 10kΩ resistor)
  - LDR Module (DO pin)    -> GPIO 34 (Digital: dark detection)
  - 8x8 LED Matrix         -> GPIO 5 (DIN), GPIO 17 (CS), GPIO 18 (CLK)
  - Buzzer                 -> GPIO 26 (Active or passive) + GND
    - Red Alert LED          -> GPIO 25 (Status)
    - WiFi Status LED        -> GPIO 2  (Connection indicator)

  KEY IMPROVEMENTS IN v4:
    ✅ RCWL-0516 radar with dual-trigger support (radar + PIR both monitored)
    ✅ 8x8 LED matrix displays detailed threat visualization
    ✅ Threat level system (CLEAR → CAUTION → DANGER → ALERT)
    ✅ Brightness auto-adjust based on ambient light (LDR feedback)
    ✅ Enhanced siren pattern (eco-mode + full-alarm variations)
    ✅ Separate tracking for radar & PIR events
    ✅ Better state machine with threat escalation
    ✅ Serial debug with live sensor telemetry
    ✅ Local HTTP + WebSocket API (mobile app connects directly, no backend)
    ✅ Button ACK with visual confirmation

   THREAT LEVEL SYSTEM — 8x8 MATRIX HCI LANGUAGE
   -------------------------------------------------------------
   The 1088AS module is a SINGLE-COLOUR (red) matrix, so states are
   communicated by SHAPE + MOTION, never by hue. Each state has a distinct,
   learnable glyph and a blink cadence that rises with urgency, so the device
   can be read at a glance and from a distance (good HCI practice):

     BOOTING        → rotating perimeter dot          (working…)
     DISARMED       → hollow ring  "○"   steady, dim   (inactive / neutral)
     CLEAR (armed)  → shield      "🛡"   steady, breathing (protected, quiet)
     CAUTION (L1)   → "?"         slow pulse 0.6 Hz    (radar saw something)
     DANGER  (L2)   → "!"         blink 2.5 Hz         (motion confirmed)
     ALERT   (L3)   → "✕"         fast blink 4 Hz      (deterrent firing)
     OFFLINE        → blue corner pixel blinking        (link lost)

   Urgency mapping is monotonic (○ → 🛡 → ? → ! → ✕) so operators build one
   mental model: "more pixels moving faster = more danger".
   Red status LED: solid for any active threat, strobing while the siren fires.


  ==========================================================
*/

#include <WiFi.h>
#include <ESPmDNS.h>
#include <mbedtls/base64.h>
#include <mbedtls/sha1.h>
// Using a small MAX7219 driver (shiftOut) instead of LedControl — compatible with ESP32

// ==================== USER CONFIG ====================
const char* WIFI_SSID     = "P4X";
const char* WIFI_PASSWORD = "dvorack1844l5";

// ==================== PIN DEFINITIONS ====================
#define PIN_RADAR      4
#define PIN_PIR        27
#define PIN_BUTTON     32   // moved off 26 (now the buzzer) to avoid conflict
#define PIN_LDR        34
#define PIN_MATRIX_DIN 5
#define PIN_MATRIX_CS  17
#define PIN_MATRIX_CLK 18
#define PIN_BUZZER     26   // buzzer + GND (matches working test wiring)
// Buzzer is driven via a dedicated LEDC channel so we can sweep frequency
// with ledcSetup() — which reconfigures the timer WITHOUT detaching the pin.
// Repeated tone() calls on ESP32 disconnected the pin every step, which caused
// the clicks/glitches and dropped perceived volume.
#define BUZZER_LEDC_CHANNEL 0
#define BUZZER_LEDC_RES     10      // 10-bit resolution → smooth pitch sweep
#define BUZZER_DUTY         512     // 50% of 1024 → full square wave (loudest)
#define PIN_LED_RED    25
#define PIN_LED_WIFI   2
#define PIN_BATTERY    35

// ==================== CONFIGURATION ====================
#define MATRIX_ROWS 8
#define MATRIX_COLS 8
#define NUM_PIXELS (MATRIX_ROWS * MATRIX_COLS)

#define LDR_DARK_WHEN_HIGH true  // Set after testing YOUR module

#define DETERRENT_DURATION_MS 5000
#define RADAR_CAUTION_MS 2000    // Time radar alone triggers caution
#define RADAR_DEBOUNCE_MS 80     // Debounce / stability window for RCWL-0516
#define RADAR_HOLD_MS 4000       // Keep "radar detected" lit this long after last HIGH
#define TRIGGER_COOLDOWN_MS 3000
#define WIFI_RETRY_INTERVAL_MS 30000
#define BUTTON_DEBOUNCE_MS 50
#define BUTTON_ACK_MS 300
#define BUTTON_ACK_BRIGHTNESS 40

#define SIREN_HIGH_HZ 2500   // high tone of the two-tone alarm
#define SIREN_LOW_HZ  1200   // low tone of the two-tone alarm
#define SIREN_TONE_MS 350    // duration of each tone before switching

// ==================== THREAT LEVELS ====================
enum ThreatLevel {
  THREAT_CLEAR = 0,      // No motion
  THREAT_CAUTION = 1,    // Radar only
  THREAT_DANGER = 2,     // PIR + Radar
  THREAT_ALERT = 3       // Full deterrent active
};

// ==================== SYSTEM STATE ====================
enum SystemState { 
  STATE_BOOTING,
  STATE_DISARMED_IDLE,
  STATE_ARMED_CLEAR,
  STATE_ARMED_CAUTION,
  STATE_ARMED_DANGER,
  STATE_ALERT
};

// ==================== GLOBAL OBJECTS ====================
// Allow several concurrent clients. The mobile app's subnet scan (and its
// WebSocket + periodic HTTP status/commands) can open multiple sockets at once;
// the ESP32 WiFiServer default of a single client causes connection-refused and
// makes discovery miss the device.
WiFiServer apiServer(80, 8);


struct LocalCommandEntry {
  uint32_t id;
  String type;
  String payload;
  String requestedBy;
  String status;
  unsigned long requestedAt;
};

static const int LOCAL_COMMAND_LOG_SIZE = 16;
LocalCommandEntry localCommands[LOCAL_COMMAND_LOG_SIZE];
int localCommandCount = 0;
uint32_t localCommandNextId = 1;

struct LocalEventEntry {
  uint32_t id;
  String type;        // "pir", "radar", "deterrent", "arm", "threat"
  String title;
  String details;
  int threatLevel;
  unsigned long timestamp;
};

static const int LOCAL_EVENT_LOG_SIZE = 32;
LocalEventEntry localEvents[LOCAL_EVENT_LOG_SIZE];
int localEventCount = 0;
uint32_t localEventNextId = 1;
bool mdnsStarted = false;
bool apiServerStarted = false;
WiFiClient wsClient;
bool wsClientConnected = false;
String wsHandshakeBuffer;
String lastLocalStatusSignature;

// Small MAX7219 driver using shiftOut so it works on ESP32 without AVR headers.
// Provides a subset of the Adafruit_NeoPixel-like API used by the rest of this
// sketch (setPixelColor, setBrightness, show, Color). This keeps the existing
// drawing functions intact while driving a single 8x8 MAX7219 (1088AS) module.
//
// Drawing is double-buffered: setPixelColor() only touches the off-screen
// 'rows' framebuffer, and show() pushes all 8 rows in one pass. This removes
// the clear-then-redraw flicker the previous immediate-write version had, which
// is important for legible, steady HCI feedback.
class MatrixWrapper {
  public:
    MatrixWrapper(int dataPin, int clkPin, int csPin, int devices): mosiPin(dataPin), clkPin(clkPin), csPin(csPin), devices(devices), intensity(8) {
      for (int i = 0; i < 8; ++i) rows[i] = 0;
    }

    void begin() {
      pinMode(mosiPin, OUTPUT);
      pinMode(clkPin, OUTPUT);
      pinMode(csPin, OUTPUT);
      digitalWrite(csPin, HIGH);

      // Initialize MAX7219 registers
      writeRegister(0x09, 0x00); // Decode mode: none
      writeRegister(0x0B, 0x07); // Scan limit: 0-7 (all digits)
      writeRegister(0x0C, 0x01); // Shutdown register: normal operation
      writeRegister(0x0F, 0x00); // Display test: off
      setIntensity(map(60, 0, 255, 0, 15));
      clear();
      flush(); // push the cleared buffer to the hardware
    }

    void clear() {
      for (int i = 0; i < 8; ++i) rows[i] = 0x00;
    }

    // Accept 0-255 like NeoPixel and map to MAX7219 0-15
    void setBrightness(int b) {
      if (b < 0) b = 0; if (b > 255) b = 255;
      intensity = map(b, 0, 255, 0, 15) & 0x0F;
      setIntensity(intensity);
    }

    // Push the framebuffer to the MAX7219 in a single pass (no flicker).
    void show() { flush(); }

    // index: 0..63 mapping row-major (row*8 + col)
    void setPixelColor(int index, uint32_t color) {
      int row = index / MATRIX_COLS;
      int col = index % MATRIX_COLS;
      if (row < 0 || row >= MATRIX_ROWS || col < 0 || col >= MATRIX_COLS) return;

      if (color != 0) rows[row] |= (1 << col);
      else rows[row] &= ~(1 << col);
    }

    // Create a nonzero color when any component > 0 so existing code can use matrix.Color(r,g,b)
    uint32_t Color(int r, int g, int b) {
      (void)r; (void)g; (void)b;
      return (r || g || b) ? 1 : 0;
    }

  private:
    int mosiPin;
    int clkPin;
    int csPin;
    int devices;
    uint8_t rows[8];
    int intensity;

    void writeRegister(uint8_t reg, uint8_t data) {
      digitalWrite(csPin, LOW);
      // MAX7219 expects two bytes: register then data
      shiftOut(mosiPin, clkPin, MSBFIRST, reg);
      shiftOut(mosiPin, clkPin, MSBFIRST, data);
      digitalWrite(csPin, HIGH);
    }

    void setIntensity(int val) { writeRegister(0x0A, val & 0x0F); }

    // Write every row of the framebuffer once. Cheap (8 SPI pairs) and avoids
    // the partial-frame tearing you get from per-pixel hardware writes.
    void flush() {
      for (int i = 0; i < 8; ++i) writeRegister(i + 1, rows[i]);
    }
};

// Instantiate the wrapper with the configured pins (single device)
MatrixWrapper matrix(PIN_MATRIX_DIN, PIN_MATRIX_CLK, PIN_MATRIX_CS, 1);

// ==================== SYSTEM STATE VARIABLES ====================
SystemState currentState = STATE_BOOTING;
ThreatLevel currentThreatLevel = THREAT_CLEAR;

bool armed = false;
bool armOverride = false;
bool armOverrideValue = false;

bool deterrentActive = false;
unsigned long deterrentStartTime = 0;
unsigned long lastTriggerTime = 0;
unsigned long lastWiFiAttempt = 0;

// Sensor state tracking
int lastPirState = LOW;
int lastRadarState = LOW;           // last stable radar state used by logic

// For radar debouncing (RCWL-0516 can be noisy) — preserve raw reading and timing
int lastRadarRaw = LOW;             // most recent raw sample
unsigned long lastRadarRawChange = 0; // when raw sample last changed
int stableRadarState = LOW;         // debounced/stable radar state

unsigned long radarActiveStart = 0;
bool radarCautionTriggered = false;
unsigned long radarHoldUntil = 0;   // keeps "radar detected" lit for RADAR_HOLD_MS
bool lastRadarPresent = false;      // edge tracking for the held state

// Button debouncing
int lastButtonReading = HIGH;
int stableButtonState = HIGH;
unsigned long lastButtonChangeTime = 0;

// Button ACK animation
bool buttonAckActive = false;
unsigned long buttonAckStart = 0;

// Matrix brightness control (auto-adjusted by LDR)
int matrixBrightness = 60;

// Battery monitoring
float batteryVoltage = 0.0;
int batteryPercent = 0;

// Component toggles
bool radarEnabled = true;
bool pirEnabled = true;
bool deterrentEnabled = true;
bool matrixEnabled = true;
bool buzzerEnabled = true;

// ==========================================================
// SETUP
// ==========================================================
void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n╔══════════════════════════════════════╗");
  Serial.println("║  SMART COOP v4 - ENHANCED FIRMWARE   ║");
  Serial.println("║  Radar + PIR + 8x8 Matrix Display    ║");
  Serial.println("╚══════════════════════════════════════╝\n");

  // Initialize pins
  pinMode(PIN_RADAR, INPUT);
  pinMode(PIN_PIR, INPUT);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_LDR, INPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_LED_WIFI, OUTPUT);
  pinMode(PIN_BATTERY, INPUT);

  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_LED_RED, LOW);
  digitalWrite(PIN_LED_WIFI, LOW);

  // Configure the buzzer LEDC channel ONCE. We keep the pin attached and only
  // re-run ledcSetup() with a new frequency from here on (no pin detach), so the
  // siren sweep stays continuous and click-free.
  ledcSetup(BUZZER_LEDC_CHANNEL, (double)SIREN_LOW_HZ, BUZZER_LEDC_RES);
  ledcAttachPin(PIN_BUZZER, BUZZER_LEDC_CHANNEL);
  ledcWrite(BUZZER_LEDC_CHANNEL, 0); // start silent

  // Initialize 8x8 LED matrix
  matrix.begin();
  matrix.clear();
  matrix.setBrightness(60);
  matrix.show();

  // WiFi setup — station (infrastructure) mode. This is the architecture that
  // was connecting reliably; auto-reconnect recovers the link if the router
  // drops it. (A SoftAP fallback was tried but interfered with the station link
  // on several boards, leaving the device stuck booting and unreachable.)
  currentState = STATE_BOOTING;
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  startWiFiConnection();

  apiServer.begin();
  apiServerStarted = true;
  Serial.println("✓ Local API server started on port 80");

  Serial.println("✓ Hardware initialized");
  Serial.println("✓ Type 'help' for serial test commands\n");
}

// ==========================================================
// MAIN LOOP
// ==========================================================
void loop() {
  handleSerialTestMode();
  handleNetwork();
  handleLocalApi();

  bool isDark = readIsDark();
  armed = armOverride ? armOverrideValue : isDark;

  handleRadarSensor();
  handlePIRSensor();
  handleButton();
  updateDeterrent();
  updateThreatLevel();
  updateIndicatorLeds();
  updateSystemStateIfIdle();
  // Update brightness BEFORE rendering so per-state breathing effects can change global intensity
  updateMatrixBrightness();
  updateMatrixDisplay();

  unsigned long now = millis();

  // Read battery voltage every 30 seconds
  static unsigned long lastBatteryRead = 0;
  if (now - lastBatteryRead > 30000) {
    batteryVoltage = readBatteryVoltage();
    batteryPercent = batteryPercentFromVoltage(batteryVoltage);
    lastBatteryRead = now;
  }
}

// ==========================================================
// LOCAL API (HTTP + WebSocket)
// ==========================================================
String jsonEscape(const String& value) {
  String out;
  out.reserve(value.length() + 8);
  for (size_t i = 0; i < value.length(); ++i) {
    char c = value[i];
    switch (c) {
      case '\\': out += "\\\\"; break;
      case '"':  out += "\\\""; break;
      case '\n': out += "\\n"; break;
      case '\r': break;
      case '\t': out += "\\t"; break;
      default: out += c; break;
    }
  }
  return out;
}

String threatLevelLabel(ThreatLevel level) {
  switch (level) {
    case THREAT_CLEAR: return "clear";
    case THREAT_CAUTION: return "caution";
    case THREAT_DANGER: return "danger";
    case THREAT_ALERT: return "alert";
  }
  return "clear";
}

String commandEntryJson(const LocalCommandEntry& entry) {
  String json = "{";
  json += "\"id\":" + String(entry.id) + ",";
  json += "\"type\":\"" + jsonEscape(entry.type) + "\",";
  json += "\"payload\":\"" + jsonEscape(entry.payload) + "\",";
  json += "\"requestedBy\":\"" + jsonEscape(entry.requestedBy) + "\",";
  json += "\"status\":\"" + jsonEscape(entry.status) + "\",";
  json += "\"requestedAt\":" + String(entry.requestedAt);
  json += "}";
  return json;
}

String commandsJson() {
  String json = "[";
  for (int i = 0; i < localCommandCount; ++i) {
    if (i) json += ",";
    json += commandEntryJson(localCommands[i]);
  }
  json += "]";
  return json;
}

String statusSignature() {
  String sig;
  sig.reserve(64);
  sig += String(armed ? 1 : 0);
  sig += '|';
  sig += String(lastPirState);
  sig += '|';
  sig += String(lastRadarState);
  sig += '|';
  sig += String(readIsDark() ? 1 : 0);
  sig += '|';
  sig += String(currentThreatLevel);
  sig += '|';
  sig += String(deterrentActive ? 1 : 0);
  sig += '|';
  sig += String(localCommandCount);
  sig += '|';
  sig += String(WiFi.status() == WL_CONNECTED ? 1 : 0);
  return sig;
}

String eventEntryJson(const LocalEventEntry& entry) {
  String json = "{";
  json += "\"id\":" + String(entry.id) + ",";
  json += "\"type\":\"" + jsonEscape(entry.type) + "\",";
  json += "\"title\":\"" + jsonEscape(entry.title) + "\",";
  json += "\"details\":\"" + jsonEscape(entry.details) + "\",";
  json += "\"threatLevel\":" + String(entry.threatLevel) + ",";
  json += "\"timestamp\":" + String(entry.timestamp);
  json += "}";
  return json;
}

String eventsJson() {
  String json = "[";
  for (int i = localEventCount - 1; i >= 0; --i) {
    if (i != localEventCount - 1) json += ",";
    json += eventEntryJson(localEvents[i]);
  }
  json += "]";
  return json;
}

void recordLocalEvent(const String& type, const String& title, const String& details, int threatLevel) {
  LocalEventEntry entry;
  entry.id = localEventNextId++;
  entry.type = type;
  entry.title = title;
  entry.details = details;
  entry.threatLevel = threatLevel;
  entry.timestamp = millis();

  if (localEventCount < LOCAL_EVENT_LOG_SIZE) {
    localEvents[localEventCount++] = entry;
  } else {
    for (int i = 1; i < LOCAL_EVENT_LOG_SIZE; ++i) {
      localEvents[i - 1] = localEvents[i];
    }
    localEvents[LOCAL_EVENT_LOG_SIZE - 1] = entry;
  }
}

void clearLocalEvents() {
  localEventCount = 0;
}

bool removeLocalEvent(uint32_t id) {
  for (int i = 0; i < localEventCount; ++i) {
    if (localEvents[i].id == id) {
      for (int j = i + 1; j < localEventCount; ++j) localEvents[j - 1] = localEvents[j];
      localEventCount--;
      return true;
    }
  }
  return false;
}

String statusJson() {
  String ip = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "";
  String json = "{";
  json += "\"device\":{";
  json += "\"pir\":" + String(lastPirState == HIGH ? "true" : "false") + ",";
  json += "\"radar\":" + String(lastRadarState == HIGH ? "true" : "false") + ",";
  json += "\"light\":" + String(readIsDark() ? "true" : "false") + ",";
  json += "\"armed\":" + String(armed ? "true" : "false") + ",";
  json += "\"online\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false") + ",";
  json += "\"deterrentActive\":" + String(deterrentActive ? "true" : "false") + ",";
  json += "\"threatLevel\":" + String(currentThreatLevel) + ",";
  json += "\"threatLabel\":\"" + threatLevelLabel(currentThreatLevel) + "\",";
  json += "\"ip\":\"" + ip + "\",";
  json += "\"updatedAt\":" + String(millis()) + ",";
  json += "\"battery\":" + String(batteryPercent) + ",";
  json += "\"components\":{";
  json += "\"radar\":" + String(radarEnabled ? "true" : "false") + ",";
  json += "\"pir\":" + String(pirEnabled ? "true" : "false") + ",";
  json += "\"deterrent\":" + String(deterrentEnabled ? "true" : "false") + ",";
  json += "\"matrix\":" + String(matrixEnabled ? "true" : "false") + ",";
  json += "\"buzzer\":" + String(buzzerEnabled ? "true" : "false");
  json += "},";
  json += "\"commands\":" + commandsJson() + ",";
  json += "\"events\":" + eventsJson();
  json += "},";
  json += "\"api\":{";
  json += "\"local\":true,";
  json += "\"websocket\":true,";
  json += "\"port\":80";
  json += "}";
  json += "}";
  return json;
}

void recordLocalCommand(const String& type, const String& payload, const String& requestedBy, const String& status) {
  LocalCommandEntry entry;
  entry.id = localCommandNextId++;
  entry.type = type;
  entry.payload = payload;
  entry.requestedBy = requestedBy;
  entry.status = status;
  entry.requestedAt = millis();

  if (localCommandCount < LOCAL_COMMAND_LOG_SIZE) {
    localCommands[localCommandCount++] = entry;
  } else {
    for (int i = 1; i < LOCAL_COMMAND_LOG_SIZE; ++i) {
      localCommands[i - 1] = localCommands[i];
    }
    localCommands[LOCAL_COMMAND_LOG_SIZE - 1] = entry;
  }
}

bool removeLocalCommand(uint32_t id) {
  for (int i = 0; i < localCommandCount; ++i) {
    if (localCommands[i].id == id) {
      for (int j = i + 1; j < localCommandCount; ++j) {
        localCommands[j - 1] = localCommands[j];
      }
      localCommandCount--;
      return true;
    }
  }
  return false;
}

void clearLocalCommands() {
  localCommandCount = 0;
}

void sendHttpResponse(WiFiClient& client, int code, const String& contentType, const String& body) {
  const char* statusText = code == 200 ? "OK" : code == 201 ? "Created" : code == 202 ? "Accepted" : code == 204 ? "No Content" : code == 400 ? "Bad Request" : code == 404 ? "Not Found" : code == 500 ? "Internal Server Error" : "OK";
  client.printf("HTTP/1.1 %d %s\r\n", code, statusText);
  client.printf("Content-Type: %s\r\n", contentType.c_str());
  client.print("Access-Control-Allow-Origin: *\r\n");
  client.print("Access-Control-Allow-Headers: Content-Type\r\n");
  client.print("Access-Control-Allow-Methods: GET,POST,DELETE,OPTIONS\r\n");
  client.printf("Content-Length: %u\r\n", (unsigned)body.length());
  client.print("Connection: close\r\n\r\n");
  client.print(body);
}

void sendHttpJson(WiFiClient& client, int code, const String& body) {
  sendHttpResponse(client, code, "application/json", body);
}

String getHeaderValue(const String& headerLine) {
  int colon = headerLine.indexOf(':');
  if (colon < 0) return "";
  String value = headerLine.substring(colon + 1);
  value.trim();
  return value;
}

String stripQueryString(String path) {
  int q = path.indexOf('?');
  return q >= 0 ? path.substring(0, q) : path;
}

bool sendWsText(WiFiClient& client, const String& message) {
  if (!client.connected()) return false;

  size_t len = message.length();
  uint8_t header[10];
  size_t headerLen = 0;
  header[0] = 0x81; // FIN + text frame
  if (len < 126) {
    header[1] = len;
    headerLen = 2;
  } else if (len < 65536) {
    header[1] = 126;
    header[2] = (len >> 8) & 0xFF;
    header[3] = len & 0xFF;
    headerLen = 4;
  } else {
    return false;
  }

  client.write(header, headerLen);
  client.write((const uint8_t*)message.c_str(), len);
  return true;
}

bool websocketAcceptKey(const String& clientKey, String& acceptKey) {
  const String magic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
  String source = clientKey + magic;

  uint8_t sha1Result[20];
  if (mbedtls_sha1_ret((const unsigned char*)source.c_str(), source.length(), sha1Result) != 0) {
    return false;
  }

  unsigned char encoded[64];
  size_t encodedLen = 0;
  if (mbedtls_base64_encode(encoded, sizeof(encoded), &encodedLen, sha1Result, sizeof(sha1Result)) != 0) {
    return false;
  }

  encoded[encodedLen] = 0;
  acceptKey = String((char*)encoded);
  return true;
}

void broadcastLocalStatus(bool force = false) {
  String sig = statusSignature();
  if (!force && sig == lastLocalStatusSignature) return;
  lastLocalStatusSignature = sig;
  if (wsClientConnected && wsClient.connected()) {
    sendWsText(wsClient, statusJson());
  }
}

void applyLocalArmMode(const String& mode) {
  if (mode == "auto") {
    armOverride = false;
  } else if (mode == "on") {
    armOverride = true;
    armOverrideValue = true;
  } else if (mode == "off") {
    armOverride = true;
    armOverrideValue = false;
  }
  recordLocalEvent("arm", "Arming Mode Changed", "System set to " + mode, 0);
}

void applyComponentToggle(const String& component) {
  if (component == "radar") {
    radarEnabled = !radarEnabled;
    recordLocalEvent("component", "Radar Toggled", radarEnabled ? "Radar sensor enabled" : "Radar sensor disabled", 0);
  } else if (component == "pir") {
    pirEnabled = !pirEnabled;
    recordLocalEvent("component", "PIR Toggled", pirEnabled ? "PIR sensor enabled" : "PIR sensor disabled", 0);
  } else if (component == "deterrent") {
    deterrentEnabled = !deterrentEnabled;
    recordLocalEvent("component", "Deterrent Toggled", deterrentEnabled ? "Deterrent system enabled" : "Deterrent system disabled", 0);
  } else if (component == "matrix") {
    matrixEnabled = !matrixEnabled;
    recordLocalEvent("component", "LED Matrix Toggled", matrixEnabled ? "LED matrix enabled" : "LED matrix disabled", 0);
  } else if (component == "buzzer") {
    buzzerEnabled = !buzzerEnabled;
    recordLocalEvent("component", "Buzzer Toggled", buzzerEnabled ? "Buzzer enabled" : "Buzzer disabled", 0);
  } else {
    Serial.print("⚠️ Invalid component toggle request: "); Serial.println(component);
    return;
  }
  broadcastLocalStatus(true);
}

void handleLocalCommand(const String& type, const String& payload, const String& requestedBy) {
  recordLocalCommand(type, payload, requestedBy, "sent");
  if (type == "deterrent") {
    triggerDeterrent();
  } else if (type == "arm") {
    applyLocalArmMode(payload);
  } else if (type == "toggle_component") {
    applyComponentToggle(payload);
  }
  broadcastLocalStatus(true);
}

void handleWebSocketFrames() {
  if (!wsClientConnected) return;
  if (!wsClient.connected()) {
    wsClient.stop();
    wsClientConnected = false;
    return;
  }

  while (wsClient.available() >= 2) {
    uint8_t first = (uint8_t)wsClient.read();
    uint8_t second = (uint8_t)wsClient.read();
    bool masked = (second & 0x80) != 0;
    uint64_t payloadLen = (second & 0x7F);

    if (payloadLen == 126) {
      if (wsClient.available() < 2) return;
      payloadLen = ((uint64_t)(uint8_t)wsClient.read() << 8) | (uint64_t)(uint8_t)wsClient.read();
    } else if (payloadLen == 127) {
      // Not needed for the small payloads used by the mobile app.
      wsClient.stop();
      wsClientConnected = false;
      return;
    }

    uint8_t mask[4] = {0, 0, 0, 0};
    if (masked) {
      if (wsClient.available() < 4) return;
      wsClient.readBytes(mask, 4);
    }

    if (wsClient.available() < (int)payloadLen) return;

    String payload;
    payload.reserve(payloadLen);
    for (uint64_t i = 0; i < payloadLen; ++i) {
      char c = (char)wsClient.read();
      if (masked) c ^= mask[i % 4];
      payload += c;
    }

    uint8_t opcode = first & 0x0F;
    if (opcode == 0x8) {
      wsClient.stop();
      wsClientConnected = false;
      return;
    }
    if (opcode == 0x9) {
      // Ping -> pong with same payload
      String pong = payload;
      if (wsClient.connected()) {
        uint8_t pongHeader[2] = {0x8A, (uint8_t)pong.length()};
        wsClient.write(pongHeader, 2);
        wsClient.write((const uint8_t*)pong.c_str(), pong.length());
      }
      continue;
    }
    if (opcode != 0x1) continue;

    String msg = payload;
    msg.toLowerCase();
if (msg.indexOf("\"type\":\"deterrent\"") >= 0 || msg.indexOf("trigger") >= 0) {
      handleLocalCommand("deterrent", "trigger", "mobile");
    } else if (msg.indexOf("\"type\":\"arm\"") >= 0) {
      String mode = "auto";
      if (msg.indexOf("\"mode\":\"on\"") >= 0) mode = "on";
      else if (msg.indexOf("\"mode\":\"off\"") >= 0) mode = "off";
      else if (msg.indexOf("\"mode\":\"auto\"") >= 0) mode = "auto";
      handleLocalCommand("arm", mode, "mobile");
    } else if (msg.indexOf("\"type\":\"toggle_component\"") >= 0) {
      int start = msg.indexOf("\"component\":\"") + 13;
      int end = msg.indexOf("\"", start);
      String component = msg.substring(start, end);
    if (component != "radar" && component != "pir" && component != "deterrent" && component != "matrix" && component != "buzzer") {
        Serial.print("⚠️ Invalid component toggle via WebSocket: "); Serial.println(component);
        continue;
      }
      handleLocalCommand("toggle_component", component, "mobile");
    } else if (msg.indexOf("\"type\":\"clear_commands\"") >= 0) {
      clearLocalCommands();
      broadcastLocalStatus(true);
    }
  }
}

void handleHttpRequest(WiFiClient& client, const String& method, String path, const String& body) {
  path = stripQueryString(path);

  // Root path: a browser/curl-friendly liveness check returning the same status
  // payload. Useful for verifying the server is reachable from a laptop.
  if (method == "GET" && (path == "/" || path == "/index.html")) {
    sendHttpJson(client, 200, statusJson());
    return;
  }

  if (method == "OPTIONS") {
    sendHttpResponse(client, 204, "text/plain", "");
    return;
  }

  if (method == "GET" && path == "/api/status") {
    sendHttpJson(client, 200, statusJson());
    return;
  }

  if (method == "GET" && path == "/api/events") {
    sendHttpJson(client, 200, String("{\"events\":") + eventsJson() + "}");
    return;
  }

  if (method == "DELETE" && path == "/api/events") {
    clearLocalEvents();
    broadcastLocalStatus(true);
    sendHttpJson(client, 200, "{\"deleted\":true}");
    return;
  }

  if (method == "DELETE" && path.startsWith("/api/events/")) {
    uint32_t id = path.substring(String("/api/events/").length()).toInt();
    if (removeLocalEvent(id)) {
      broadcastLocalStatus(true);
      sendHttpJson(client, 200, "{\"deleted\":true}");
    } else {
      sendHttpJson(client, 404, "{\"error\":\"Event not found.\"}");
    }
    return;
  }

  if (method == "GET" && path == "/api/commands") {
    sendHttpJson(client, 200, String("{\"commands\":") + commandsJson() + "}");
    return;
  }

  if (method == "DELETE" && path == "/api/commands") {
    clearLocalCommands();
    broadcastLocalStatus(true);
    sendHttpJson(client, 200, "{\"deleted\":true}");
    return;
  }

  if (method == "DELETE" && path.startsWith("/api/commands/")) {
    uint32_t id = path.substring(String("/api/commands/").length()).toInt();
    bool deleted = removeLocalCommand(id);
    if (deleted) {
      broadcastLocalStatus(true);
      sendHttpJson(client, 200, "{\"deleted\":true}");
    } else {
      sendHttpJson(client, 404, "{\"error\":\"Command not found.\"}");
    }
    return;
  }

  if (method == "POST" && path == "/api/commands/deterrent") {
    handleLocalCommand("deterrent", body.length() ? body : "trigger", "mobile");
    sendHttpJson(client, 202, "{\"accepted\":true}");
    return;
  }

  if (method == "POST" && path == "/api/commands/arm") {
    String mode = "auto";
    String bodyLower = body;
    bodyLower.toLowerCase();
    if (bodyLower.indexOf("\"mode\":\"on\"") >= 0 || bodyLower.indexOf("mode=on") >= 0) mode = "on";
    else if (bodyLower.indexOf("\"mode\":\"off\"") >= 0 || bodyLower.indexOf("mode=off") >= 0) mode = "off";
    else if (bodyLower.indexOf("\"mode\":\"auto\"") >= 0 || bodyLower.indexOf("mode=auto") >= 0) mode = "auto";
    handleLocalCommand("arm", mode, "mobile");
    sendHttpJson(client, 202, "{\"accepted\":true}");
    return;
  }

  if (method == "POST" && path == "/api/commands/toggle_component") {
    String component = "";
    String bodyLower = body;
    bodyLower.toLowerCase();
    if (bodyLower.indexOf("\"component\":\"pir\"") >= 0 || bodyLower.indexOf("component=pir") >= 0) component = "pir";
    else if (bodyLower.indexOf("\"component\":\"deterrent\"") >= 0 || bodyLower.indexOf("component=deterrent") >= 0) component = "deterrent";
    else if (bodyLower.indexOf("\"component\":\"matrix\"") >= 0 || bodyLower.indexOf("component=matrix") >= 0) component = "matrix";
    else if (bodyLower.indexOf("\"component\":\"radar\"") >= 0 || bodyLower.indexOf("component=radar") >= 0) component = "radar";
    else if (bodyLower.indexOf("\"component\":\"buzzer\"") >= 0 || bodyLower.indexOf("component=buzzer") >= 0) component = "buzzer";
      if (component != "radar" && component != "pir" && component != "deterrent" && component != "matrix" && component != "buzzer") {
      sendHttpJson(client, 400, "{\"error\":\"Invalid component. Must be one of: radar, pir, deterrent, matrix, buzzer\"}");
      return;
    }
    handleLocalCommand("toggle_component", component, "mobile");
    sendHttpJson(client, 202, "{\"accepted\":true}");
    return;
  }

  sendHttpJson(client, 404, "{\"error\":\"Not found\"}");
}

void handleLocalApi() {
  if (!apiServerStarted) return;

  if (wsClientConnected && !wsClient.connected()) {
    wsClient.stop();
    wsClientConnected = false;
  }

  handleWebSocketFrames();
  broadcastLocalStatus(false);

  WiFiClient client = apiServer.available();
  if (!client) return;
  if (!client.connected()) { client.stop(); return; }

  // ESP32 quirk: apiServer.available() can hand us the client before the TCP
  // payload is buffered. Wait briefly for the first byte so we don't read an
  // empty line and drop the connection. A generous line timeout keeps a request
  // line that arrives split across TCP segments intact (a short timeout here was
  // dropping whole connections).
  client.setTimeout(1000);
  unsigned long firstByteWait = millis();
  while (client.connected() && !client.available() && millis() - firstByteWait < 1000) {
    delay(2);
  }
  String requestLine = client.readStringUntil('\n');
  requestLine.trim();
  if (requestLine.length() == 0) {
    client.stop();
    return;
  }

  int firstSpace = requestLine.indexOf(' ');
  int secondSpace = requestLine.indexOf(' ', firstSpace + 1);
  if (firstSpace < 0 || secondSpace < 0) {
    client.stop();
    return;
  }
  String method = requestLine.substring(0, firstSpace);
  String path = requestLine.substring(firstSpace + 1, secondSpace);

  Serial.printf("🌐 %s %s from %s\n", method.c_str(), path.c_str(),
                client.remoteIP().toString().c_str());

  int contentLength = 0;
  String wsKey;
  bool wantsWebSocket = false;

  while (client.connected()) {
    String header = client.readStringUntil('\n');
    header.trim();
    if (!header.length()) break;
    String lower = header;
    lower.toLowerCase();
    if (lower.startsWith("content-length:")) {
      contentLength = getHeaderValue(header).toInt();
    } else if (lower.startsWith("sec-websocket-key:")) {
      wsKey = getHeaderValue(header);
    } else if (lower.startsWith("upgrade:")) {
      wantsWebSocket = lower.indexOf("websocket") >= 0;
    }
  }

  String body;
  while ((int)body.length() < contentLength && client.connected()) {
    if (!client.available()) { delay(1); continue; }
    body += (char)client.read();
  }

  if (path == "/ws" && wantsWebSocket && wsKey.length()) {
    String acceptKey;
    if (websocketAcceptKey(wsKey, acceptKey)) {
      client.printf("HTTP/1.1 101 Switching Protocols\r\n");
      client.print("Upgrade: websocket\r\n");
      client.print("Connection: Upgrade\r\n");
      client.print("Sec-WebSocket-Accept: ");
      client.print(acceptKey);
      client.print("\r\n\r\n");

      if (wsClientConnected) {
        wsClient.stop();
      }
      wsClient = client;
      wsClientConnected = true;
      broadcastLocalStatus(true);
      return;
    }
  }

  handleHttpRequest(client, method, path, body);
  client.stop();
}

// ==========================================================
// LDR - LIGHT LEVEL DETECTION
// ==========================================================
bool readIsDark() {
  int raw = digitalRead(PIN_LDR);
  bool rawHigh = (raw == HIGH);
  return LDR_DARK_WHEN_HIGH ? rawHigh : !rawHigh;
}

float readBatteryVoltage() {
  int raw = analogRead(PIN_BATTERY);
  float voltage = (raw / 4095.0) * 3.3 * 2.0;
  return voltage;
}

int batteryPercentFromVoltage(float voltage) {
  if (voltage >= 4.20) return 100;
  if (voltage <= 3.30) return 0;
  if (voltage >= 3.90) return (int)((voltage - 3.90) / (4.20 - 3.90) * 50 + 50);
  if (voltage >= 3.60) return (int)((voltage - 3.60) / (3.90 - 3.60) * 30 + 20);
  return (int)((voltage - 3.30) / (3.60 - 3.30) * 20);
}

void updateMatrixBrightness() {
  // Auto-adjust matrix brightness based on ambient light (darker = dimmer)
  bool isDark = readIsDark();
  int base = isDark ? 40 : 120;

  if (deterrentActive || currentState == STATE_ALERT) {
    base = 255;                                  // full brightness during alert
  } else if (currentState == STATE_ARMED_CLEAR) {
    // Noticeable breathing on the armed-clear moon so it reads as "alive"
    float phase   = (millis() % 3000) / 3000.0f;
    float breathe = 0.5f + 0.5f * (phase < 0.5f ? phase * 2.0f : (1.0f - phase) * 2.0f);
    base = (int)(base * breathe);
  } else if (currentState == STATE_DISARMED_IDLE) {
    // Very slow, subtle pulse so standby doesn't look dead
    float phase   = (millis() % 5000) / 5000.0f;
    float breathe = 0.8f + 0.2f * (phase < 0.5f ? phase * 2.0f : (1.0f - phase) * 2.0f);
    base = (int)(base * breathe);
  }

  matrixBrightness = base;
  matrix.setBrightness(matrixBrightness);
}

// ==========================================================
// SENSOR HANDLING - RADAR (RCWL-0516)
// ==========================================================
void handleRadarSensor() {
  // Disabled via app/serial toggle — contribute nothing to threat logic
  if (!radarEnabled) {
    stableRadarState = LOW;
    lastRadarState   = LOW;
    lastRadarRaw     = LOW;
    radarHoldUntil   = 0;
    lastRadarPresent = false;
    return;
  }

  // Read raw input and debounce to produce a stableRadarState suitable for logic
  int radarRawSample = digitalRead(PIN_RADAR);
  if (radarRawSample != lastRadarRaw) {
    lastRadarRaw = radarRawSample;
    lastRadarRawChange = millis();
  }

  if (lastRadarRaw != stableRadarState && (millis() - lastRadarRawChange) > RADAR_DEBOUNCE_MS) {
    stableRadarState = lastRadarRaw;
    Serial.print("📡 RADAR: Stable -> "); Serial.println(stableRadarState == HIGH ? "HIGH" : "LOW");
  }

  // Hold the "detected" state for a short window after the last HIGH so the UI
  // dot and CAUTION level stay visible instead of flickering off the instant
  // the sensor's output drops.
  if (stableRadarState == HIGH) radarHoldUntil = millis() + RADAR_HOLD_MS;
  bool radarPresent = (stableRadarState == HIGH) || (millis() < radarHoldUntil);
  bool radarPresentTransition = (radarPresent != lastRadarPresent);

  if (armed && radarPresent) {
    if (radarPresentTransition) {
      radarActiveStart = millis();
      radarCautionTriggered = false;
      Serial.println("📡 RADAR: Motion detected (stable)!");
    }
    unsigned long radarDuration = millis() - radarActiveStart;
    if (!radarCautionTriggered && radarDuration > RADAR_CAUTION_MS) {
      radarCautionTriggered = true;
      currentThreatLevel = THREAT_CAUTION;
      recordLocalEvent("radar", "Radar Motion Detected", "RCWL-0516 microwave radar detected movement nearby", 1);
      Serial.println("📡 RADAR: Sustained motion - CAUTION level");
    }
  } else if (!radarPresent && radarPresentTransition) {
    radarCautionTriggered = false;
    if (currentThreatLevel == THREAT_CAUTION && lastPirState == LOW) {
      currentThreatLevel = THREAT_CLEAR;
    }
  }

  lastRadarPresent = radarPresent;
  lastRadarState   = radarPresent ? HIGH : LOW;
}

// ==========================================================
// SENSOR HANDLING - PIR (Traditional Motion)
// ==========================================================
void handlePIRSensor() {
  // Disabled via app/serial toggle — do not trigger or escalate
  if (!pirEnabled) {
    lastPirState = LOW;
    return;
  }

  int pirState = digitalRead(PIN_PIR);
  bool pirTransition = (pirState != lastPirState);

  if (armed && pirState == HIGH && lastPirState == LOW) {
    unsigned long now = millis();
    if (now - lastTriggerTime > TRIGGER_COOLDOWN_MS) {
      // PIR fired! Check if radar is also active for threat level
      if (lastRadarState == HIGH) {
        currentThreatLevel = THREAT_DANGER;
        recordLocalEvent("pir", "Dual Motion Threat", "PIR + Radar simultaneous motion detected", 2);
        Serial.println("🚶 PIR: Motion + RADAR active - DANGER level");
      } else {
        currentThreatLevel = THREAT_CAUTION;
        recordLocalEvent("pir", "PIR Motion Detected", "Passive infrared motion sensor triggered", 1);
        Serial.println("🚶 PIR: Motion detected");
      }
      
      triggerDeterrent();
      lastTriggerTime = now;
    }
  }

  lastPirState = pirState;
}

// ==========================================================
// BUTTON HANDLING (Debounced)
// ==========================================================
void handleButton() {
  int reading = digitalRead(PIN_BUTTON);

  if (reading != lastButtonReading) {
    lastButtonChangeTime = millis();
  }

  if ((millis() - lastButtonChangeTime) > BUTTON_DEBOUNCE_MS) {
    if (reading != stableButtonState) {
      stableButtonState = reading;
      if (stableButtonState == LOW) {
        buttonAckActive = true;
        buttonAckStart = millis();
        Serial.println("🔘 BUTTON: Manual trigger!");
        triggerDeterrent();
      }
    }
  }
  lastButtonReading = reading;
}

// ==========================================================
// THREAT LEVEL MANAGEMENT
// ==========================================================
void updateThreatLevel() {
  if (deterrentActive) {
    currentThreatLevel = THREAT_ALERT;
    return;
  }

  if (!armed) {
    currentThreatLevel = THREAT_CLEAR;
    return;
  }

  // If both sensors went quiet, reset to CLEAR
  if (lastRadarState == LOW && lastPirState == LOW) {
    currentThreatLevel = THREAT_CLEAR;
  }
  // If only radar active, keep at CAUTION
  else if (lastRadarState == HIGH && lastPirState == LOW) {
    if (currentThreatLevel < THREAT_CAUTION) {
      currentThreatLevel = THREAT_CAUTION;
    }
  }
  // If PIR is active, escalate to DANGER
  else if (lastPirState == HIGH) {
    currentThreatLevel = THREAT_DANGER;
  }
}

// ==========================================================
// DETERRENT (Lights + Siren)
// ==========================================================
void triggerDeterrent() {
  if (!deterrentEnabled) return;   // deterrent switched off via toggle
  deterrentActive = true;
  deterrentStartTime = millis();
  currentThreatLevel = THREAT_ALERT;
  currentState = STATE_ALERT;
  recordLocalEvent("deterrent", "Deterrent Activated", "Strobe lights & high-decibel siren engaged", 3);
  Serial.println("🚨 DETERRENT TRIGGERED!");
}

// Cached siren state — used to avoid re-writing the LEDC frequency more often
// than necessary (keeps the sweep smooth without hammering the peripheral).
static int   lastSirenFreq = 0;
static bool  lastSirenOn   = false;

// Silence the buzzer cleanly by setting duty to 0 (no pin detach / timer reset).
void buzzerSilence() {
  ledcWrite(BUZZER_LEDC_CHANNEL, 0);
  lastSirenOn   = false;
  lastSirenFreq = 0;
}

void updateSiren() {
  unsigned long elapsed   = millis() - deterrentStartTime;
  // Simple two-tone alarm: alternate HIGH and LOW pitches (no sweeping wail).
  unsigned long cycle    = (unsigned long)SIREN_TONE_MS * 2;
  unsigned long phase     = elapsed % cycle;
  int targetFreq = (phase < (unsigned long)SIREN_TONE_MS) ? SIREN_HIGH_HZ : SIREN_LOW_HZ;

  // Only touch the LEDC channel when the tone actually changes. ledcSetup()
  // reconfigures the timer WITHOUT detaching the pin, so switching is clean
  // (no clicks) and the 50% duty keeps the volume high.
  if (targetFreq != lastSirenFreq) {
    ledcSetup(BUZZER_LEDC_CHANNEL, (double)targetFreq, BUZZER_LEDC_RES);
    ledcWrite(BUZZER_LEDC_CHANNEL, BUZZER_DUTY);
    lastSirenFreq = targetFreq;
  }
  if (!lastSirenOn) {
    ledcWrite(BUZZER_LEDC_CHANNEL, BUZZER_DUTY); // 50% duty square wave
    lastSirenOn = true;
  }
  if (!lastSirenOn) {
    ledcWrite(BUZZER_LEDC_CHANNEL, BUZZER_DUTY); // 50% duty square wave
    lastSirenOn = true;
  }
}

void updateDeterrent() {
  if (!deterrentActive) return;
  if (!buzzerEnabled) { buzzerSilence(); return; }

  unsigned long elapsed = millis() - deterrentStartTime;
  updateSiren();
  
  if (elapsed > DETERRENT_DURATION_MS) {
    deterrentActive = false;
    buzzerSilence();
    Serial.println("✓ Deterrent cycle complete");
  }
}

// Red alert LED: solid whenever there is an active threat, and strobing while
// the deterrent burst is actually firing. (WiFi LED is driven in handleNetwork.)
void updateIndicatorLeds() {
  if (deterrentActive) {
    digitalWrite(PIN_LED_RED, (millis() / 90) % 2);          // fast strobe during siren
  } else if (currentThreatLevel >= THREAT_CAUTION) {
    digitalWrite(PIN_LED_RED, HIGH);                         // persistent threat cue
  } else {
    digitalWrite(PIN_LED_RED, LOW);
  }
}

void updateSystemStateIfIdle() {
  if (deterrentActive) {
    currentState = STATE_ALERT;
    return;
  }

  if (currentState == STATE_BOOTING) {
    if (WiFi.status() == WL_CONNECTED) {
      currentState = armed ? STATE_ARMED_CLEAR : STATE_DISARMED_IDLE;
    }
    return;
  }

  if (!armed) {
    currentState = STATE_DISARMED_IDLE;
  } else {
    switch (currentThreatLevel) {
      case THREAT_CLEAR:   currentState = STATE_ARMED_CLEAR;    break;
      case THREAT_CAUTION: currentState = STATE_ARMED_CAUTION;  break;
      case THREAT_DANGER:  currentState = STATE_ARMED_DANGER;   break;
      case THREAT_ALERT:   currentState = STATE_ALERT;          break;
    }
  }
}

// ==========================================================
// 8x8 LED MATRIX DISPLAY FUNCTIONS
// ==========================================================
//
// HCI iconography. The panel is monochrome, so every state is a distinct GLYPH
// (shape you can learn) plus a BLINK CADENCE that only increases with urgency.
// Glyphs are 8x8 bitmaps: '#' = lit, '.' = dark. Kept as readable strings so
// the visual language is obvious at a glance and easy to tweak.
// ==========================================================
void setPixelXY(int row, int col, uint32_t color) {
  if (row < 0 || row >= MATRIX_ROWS || col < 0 || col >= MATRIX_COLS) return;
  int index = row * MATRIX_COLS + col;
  matrix.setPixelColor(index, color);
}

// Render an 8x8 glyph bitmap (row-major, '#' lit). Used by every state draw.
void drawGlyph(const char* glyph[8], uint32_t color) {
  for (int r = 0; r < 8; ++r) {
    for (int c = 0; c < 8; ++c) {
      if (glyph[r][c] == '#') setPixelXY(r, c, color);
    }
  }
}

// ---- Glyph definitions (monochrome, shape-coded) -------------------------

// BOOTING: rotating dot around the perimeter (handled separately below).

// DISARMED / standby: hollow ring = "neutral, powered but off".
static const char* GLYPH_RING[8] = {
  ".######.",
  "#......#",
  "#......#",
  "#......#",
  "#......#",
  "#......#",
  "#......#",
  ".######.",
};

// ARMED + CLEAR: shield = "protected, monitoring, safe".
static const char* GLYPH_SHIELD[8] = {
  "..####..",
  ".######.",
  "########",
  "#  #### #",
  "#  #  # #",
  "#  #  # #",
  "#  #  # #",
  "..#  #..",
};

// CAUTION (radar only): "?" = "sensed something, not yet confirmed".
static const char* GLYPH_QUESTION[8] = {
  "..####..",
  ".######.",
  "######..",
  "..####..",
  "...###..",
  "....##..",
  "........",
  "...##...",
};

// DANGER (PIR+radar): "!" = "confirmed intruder".
static const char* GLYPH_BANG[8] = {
  "...##...",
  "...##...",
  "...##...",
  "...##...",
  "...##...",
  "...##...",
  "........",
  "...##...",
};

// ALERT (deterrent firing): "X" = "active response".
static const char* GLYPH_X[8] = {
  "#......#",
  ".#....#.",
  "..#..#..",
  "...##...",
  "...##...",
  "..#..#..",
  ".#....#.",
  "#......#",
};

// ---- State renderers -----------------------------------------------------

void drawBootingSpinner() {
  // Rotating perimeter dot — unambiguous "working / initialising".
  static const int perim[28][2] = {
    {0,0},{0,1},{0,2},{0,3},{0,4},{0,5},{0,6},{0,7},
    {1,7},{2,7},{3,7},{4,7},{5,7},{6,7},{7,7},
    {7,6},{7,5},{7,4},{7,3},{7,2},{7,1},{7,0},
    {6,0},{5,0},{4,0},{3,0},{2,0},{1,0}
  };
  int pos = (millis() / 60) % 28;
  setPixelXY(perim[pos][0], perim[pos][1], matrix.Color(255, 255, 255));
}

void drawDisarmedIdle() {
  // Hollow ring, steady + dim. Reads as "off but alive".
  drawGlyph(GLYPH_RING, matrix.Color(255, 255, 255));
}

void drawArmedClear() {
  // Shield, steady + breathing (handled by updateMatrixBrightness). Reads as
  // "armed and protecting, all quiet".
  drawGlyph(GLYPH_SHIELD, matrix.Color(255, 255, 255));
}

void drawArmedCaution() {
  // "?" pulsing slowly (~0.6 Hz). Same glyph lit/unlit so motion = "watching".
  if ((millis() / 800) % 2 == 0) {
    drawGlyph(GLYPH_QUESTION, matrix.Color(255, 255, 255));
  }
}

void drawArmedDanger() {
  // "!" blinking at a clear medium rate (~2.5 Hz) — confirmed threat.
  if ((millis() / 200) % 2 == 0) {
    drawGlyph(GLYPH_BANG, matrix.Color(255, 255, 255));
  }
}

void drawAlert() {
  // "X" fast-blinking (~4 Hz) at full brightness — deterrent is firing.
  // Cadence + full-intensity brightness make this unmistakable from afar.
  if ((millis() / 125) % 2 == 0) {
    drawGlyph(GLYPH_X, matrix.Color(255, 255, 255));
  }
}

void drawButtonAckOverlay() {
  if (millis() - buttonAckStart > BUTTON_ACK_MS) {
    buttonAckActive = false;
    return;
  }
  // Brief full-panel flash = immediate, unambiguous "press acknowledged".
  for (int i = 0; i < NUM_PIXELS; i++) {
    matrix.setPixelColor(i, matrix.Color(255, 255, 255));
  }
}

void updateMatrixDisplay() {
  matrix.clear();

  // Matrix switched off via toggle — leave the panel dark
  if (!matrixEnabled) {
    matrix.show();
    return;
  }

  switch (currentState) {
    case STATE_BOOTING:
      drawBootingSpinner();
      break;
    case STATE_DISARMED_IDLE:
      drawDisarmedIdle();
      break;
    case STATE_ARMED_CLEAR:
      drawArmedClear();
      break;
    case STATE_ARMED_CAUTION:
      drawArmedCaution();
      break;
    case STATE_ARMED_DANGER:
      drawArmedDanger();
      break;
    case STATE_ALERT:
      drawAlert();
      break;
  }

  if (buttonAckActive) {
    drawButtonAckOverlay();
  }

  // Offline marker: if we've lost the WiFi link to the app, blink a corner
  // pixel so the device itself says "not connected" (monochrome white).
  if (WiFi.status() != WL_CONNECTED && (millis() / 500) % 2 == 0) {
    setPixelXY(0, 0, matrix.Color(255, 255, 255));
  }

  matrix.show();
}

// ==========================================================
// WiFi / Network services (no backend — the mobile app talks
// to this device directly over HTTP + WebSocket + mDNS)
// ==========================================================
void handleNetwork() {
  if (WiFi.status() != WL_CONNECTED) {
    digitalWrite(PIN_LED_WIFI, (millis() / 300) % 2);
    startWiFiConnection();
  } else {
    digitalWrite(PIN_LED_WIFI, HIGH);
    if (!mdnsStarted) {
      Serial.print("✓ Station linked. Device IP: ");
      Serial.println(WiFi.localIP());
      if (MDNS.begin("coop-plus")) {
        MDNS.addService("http", "tcp", 80);
        MDNS.addServiceTxt("http", "tcp", "path", "/api/status");
        MDNS.addServiceTxt("http", "tcp", "device", "coop-plus");
        mdnsStarted = true;
        Serial.println("✓ mDNS Responder started: http://coop-plus.local");
      }
    }
  }
}

void startWiFiConnection() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (lastWiFiAttempt != 0 && millis() - lastWiFiAttempt < WIFI_RETRY_INTERVAL_MS) return;
  lastWiFiAttempt = millis();

  Serial.print("📡 Connecting to WiFi...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

// ==========================================================
// SERIAL TEST MODE
// ==========================================================
void handleSerialTestMode() {
  if (!Serial.available()) return;
  String cmd = Serial.readStringUntil('\n');
  cmd.trim();
  cmd.toLowerCase();

  if (cmd == "help") {
    printHelpMenu();
  }
  else if (cmd == "led") {
    testRedLED();
  }
  else if (cmd == "buzzer") {
    testBuzzer();
  }
  else if (cmd == "matrix") {
    testMatrix();
  }
  else if (cmd == "matrix_raw") {
    testMatrixRaw();
  }
  else if (cmd == "status") {
    printSystemStatus();
  }
  else if (cmd == "telemetry") {
    enableTelemetry();
  }
  else if (cmd == "ldr_calib") {
    calibrateLDR();
  }
  else {
    Serial.println("❌ Unknown command. Type 'help' for options.");
  }
}

void printHelpMenu() {
  Serial.println("\n╔════════════════════════════════════╗");
  Serial.println("║        SERIAL TEST COMMANDS         ║");
  Serial.println("╠════════════════════════════════════╣");
  Serial.println("║ help           - Show this menu     ║");
  Serial.println("║ status         - System status      ║");
  Serial.println("║ telemetry      - Live sensor stream ║");
  Serial.println("║ led            - Test red LED       ║");
  Serial.println("║ buzzer         - Test buzzer        ║");
  Serial.println("║ matrix         - Test LED matrix    ║");
  Serial.println("║ ldr_calib      - Calibrate LDR      ║");
  Serial.println("╚════════════════════════════════════╝\n");
}

void testRedLED() {
  Serial.println("🔴 Testing Red Alert LED...");
  for (int i = 0; i < 3; i++) {
    digitalWrite(PIN_LED_RED, HIGH); delay(200);
    digitalWrite(PIN_LED_RED, LOW);  delay(200);
  }
  Serial.println("✓ Red LED test complete\n");
}

void testBuzzer() {
  Serial.println("🔊 Testing Buzzer (pattern, 2s)...");
  unsigned long start = millis();
  // Use deterrent-style siren pattern for test (short-lived)
  unsigned long savedDeterrentStart = deterrentStartTime;
  bool savedDetActive = deterrentActive;
  deterrentStartTime = millis();
  deterrentActive = true;

  while (millis() - start < 2000) {
    if (buzzerEnabled) updateSiren();
    else buzzerSilence();
    delay(25);
  }

  deterrentActive = savedDetActive;
  deterrentStartTime = savedDeterrentStart;
  buzzerSilence();
  Serial.println("✓ Buzzer test complete\n");
}

void testMatrix() {
  Serial.println("📊 Testing Matrix (cycling states)...");
  SystemState states[] = {STATE_BOOTING, STATE_DISARMED_IDLE, STATE_ARMED_CLEAR, 
                          STATE_ARMED_CAUTION, STATE_ARMED_DANGER, STATE_ALERT};
  SystemState saved = currentState;

  for (SystemState state : states) {
    currentState = state;
    unsigned long start = millis();
    while (millis() - start < 1500) {
      updateMatrixDisplay();
      delay(30);
    }
  }

  matrix.clear();
  matrix.show();
  currentState = saved;
  Serial.println("✓ Matrix test complete\n");
}

void testMatrixRaw() {
  Serial.println("🧪 Matrix RAW hardware test (MAX7219 shiftOut)...");
  matrix.clear();
  matrix.show();
  delay(500);

  // Row sweep: one row at a time
  for (int r = 0; r < 8; r++) {
    matrix.clear();
    for (int c = 0; c < 8; c++) matrix.setPixelColor(r * 8 + c, matrix.Color(255, 255, 255));
    matrix.show();
    delay(300);
  }

  // Column sweep: one column at a time
  for (int c = 0; c < 8; c++) {
    matrix.clear();
    for (int r = 0; r < 8; r++) matrix.setPixelColor(r * 8 + c, matrix.Color(255, 255, 255));
    matrix.show();
    delay(300);
  }

  // All on / all off
  matrix.clear();
  for (int i = 0; i < 64; i++) matrix.setPixelColor(i, matrix.Color(255, 255, 255));
  matrix.show();
  delay(800);
  matrix.clear();
  matrix.show();

  Serial.println("✓ Matrix raw hardware test complete\n");
}

void printSystemStatus() {
  Serial.println("\n╔════════════════════════════════════╗");
  Serial.println("║         SYSTEM STATUS REPORT       ║");
  Serial.println("╠════════════════════════════════════╣");

  Serial.print("║ WiFi:           ");
  Serial.println(WiFi.status() == WL_CONNECTED ? "✓ Connected  ║" : "✗ Offline    ║");

  Serial.print("║ Local API:      ");
  Serial.println(apiServerStarted ? "✓ Ready      ║" : "✗ Offline    ║");

  Serial.print("║ WebSocket:      ");
  Serial.println(wsClientConnected ? "✓ Client     ║" : "✗ None       ║");

  Serial.print("║ Armed:          ");
  Serial.println(armed ? "✓ YES        ║" : "✗ NO         ║");

  Serial.print("║ PIR:            ");
  Serial.println(lastPirState == HIGH ? "🔴 ACTIVE    ║" : "⚫ Clear      ║");

  Serial.print("║ Radar:          ");
  Serial.println(lastRadarState == HIGH ? "📡 ACTIVE    ║" : "⚫ Clear      ║");

  Serial.print("║ Light:          ");
  Serial.println(readIsDark() ? "🌙 DARK      ║" : "☀️ BRIGHT    ║");

  Serial.print("║ Threat Level:   ");
  switch (currentThreatLevel) {
    case THREAT_CLEAR:   Serial.println("🟢 CLEAR     ║"); break;
    case THREAT_CAUTION: Serial.println("🟡 CAUTION   ║"); break;
    case THREAT_DANGER:  Serial.println("🟠 DANGER    ║"); break;
    case THREAT_ALERT:   Serial.println("🔴 ALERT     ║"); break;
  }

  Serial.println("╚════════════════════════════════════╝\n");
}

void enableTelemetry() {
  Serial.println("📊 Live Telemetry (30 seconds). Press Ctrl+C to stop.\n");
  unsigned long start = millis();
  
  while (millis() - start < 30000) {
    if (Serial.available() && Serial.read() == 3) break; // Ctrl+C
    
    Serial.print("PIR:");   Serial.print(lastPirState ? "🔴 " : "⚫ ");
    Serial.print("| Radar:"); Serial.print(lastRadarState ? "📡 " : "⚫ ");
    Serial.print("| Light:"); Serial.print(readIsDark() ? "🌙 " : "☀️ ");
    Serial.print("| Threat:"); Serial.print(currentThreatLevel);
    Serial.print("| Armed:"); Serial.print(armed ? "✓" : "✗");
    Serial.print("| State:"); Serial.println(currentState);
    
    delay(500);
  }
  Serial.println("\n✓ Telemetry ended\n");
}

void calibrateLDR() {
  Serial.println("🔦 LDR Calibration Mode");
  Serial.println("Cover the LDR fully and keep it covered...\n");
  delay(3000);

  Serial.println("Reading covered state (5 samples):");
  int covered_sum = 0;
  for (int i = 0; i < 5; i++) {
    int raw = digitalRead(PIN_LDR);
    covered_sum += raw;
    Serial.print("  Sample "); Serial.print(i+1); Serial.print(": ");
    Serial.println(raw ? "HIGH" : "LOW");
    delay(500);
  }
  int covered_avg = covered_sum / 5;

  Serial.println("\nNow shine a light on the LDR...");
  delay(3000);

  Serial.println("Reading bright state (5 samples):");
  int bright_sum = 0;
  for (int i = 0; i < 5; i++) {
    int raw = digitalRead(PIN_LDR);
    bright_sum += raw;
    Serial.print("  Sample "); Serial.print(i+1); Serial.print(": ");
    Serial.println(raw ? "HIGH" : "LOW");
    delay(500);
  }
  int bright_avg = bright_sum / 5;

  Serial.println("\n╔════════════════════════════════════╗");
  Serial.print("║ COVERED (dark):  "); Serial.println(covered_avg ? "HIGH       ║" : "LOW        ║");
  Serial.print("║ BRIGHT (light):  "); Serial.println(bright_avg ? "HIGH       ║" : "LOW        ║");

  if (covered_avg == 1 && bright_avg == 0) {
    Serial.println("║ RESULT: Set LDR_DARK_WHEN_HIGH=true ║");
  } else if (covered_avg == 0 && bright_avg == 1) {
    Serial.println("║ RESULT: Set LDR_DARK_WHEN_HIGH=false║");
  } else {
    Serial.println("║ RESULT: Check your LDR module       ║");
  }
  Serial.println("╚════════════════════════════════════╝\n");
}

// ==========================================================
// END OF FILE
// ==========================================================