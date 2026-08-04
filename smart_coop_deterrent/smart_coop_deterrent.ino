/*
  ==========================================================
   SMART COOP PREDATOR DETERRENT — ESP32 Firmware (v4)
   ENHANCED: Full 8x8 LED Matrix + RCWL-0516 Radar Support
  ==========================================================
  
  Hardware Setup:
    - RCWL-0516 Radar        -> GPIO 4  (3.3V OUT signal)
    - PIR Motion Sensor      -> GPIO 27 (3.3V OUT signal)
    - Push Button            -> GPIO 26 (INPUT_PULLUP with 10kΩ resistor)
    - LDR Module (DO pin)    -> GPIO 34 (Digital: dark detection)
    - 8x8 LED Matrix         -> GPIO 5 (DIN), GPIO 17 (CS), GPIO 18 (CLK)
    - Buzzer                 -> GPIO 33 (Active or passive)
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
    ✅ MQTT threat level reporting
    ✅ Button ACK with visual confirmation

  THREAT LEVEL SYSTEM:
    CLEAR (Level 0):   No motion detected → green glyph
    CAUTION (Level 1): Radar only active → yellow border
    DANGER (Level 2):  PIR triggered, radar active → orange frame
    ALERT (Level 3):   Full deterrent active → red flashing eyes

  ==========================================================
*/

#include <WiFi.h>
#include <PubSubClient.h>
// Using a small MAX7219 driver (shiftOut) instead of LedControl — compatible with ESP32

// ==================== USER CONFIG ====================
const char* WIFI_SSID     = "P4X";
const char* WIFI_PASSWORD = "dvorack1844l5";

const char* MQTT_BROKER   = "192.168.26.160";
const int   MQTT_PORT     = 1883;
const char* MQTT_CLIENT_ID= "smart_coop_esp32";
const char* MQTT_USER     = "coop_device";
const char* MQTT_PASS     = "password123";

// MQTT Topics
const char* TOPIC_PIR           = "coop/status/pir";
const char* TOPIC_RADAR         = "coop/status/radar";
const char* TOPIC_LIGHT         = "coop/status/light";
const char* TOPIC_THREAT_LEVEL  = "coop/status/threat_level";
const char* TOPIC_ARMED         = "coop/status/armed";
const char* TOPIC_ALERT         = "coop/alert/predator";
const char* TOPIC_ONLINE        = "coop/status/online";
const char* TOPIC_CMD_DETERRENT = "coop/cmd/deterrent";
const char* TOPIC_CMD_ARM       = "coop/cmd/arm";

// ==================== PIN DEFINITIONS ====================
#define PIN_RADAR      4
#define PIN_PIR        27
#define PIN_BUTTON     26
#define PIN_LDR        34
#define PIN_MATRIX_DIN 5
#define PIN_MATRIX_CS  17
#define PIN_MATRIX_CLK 18
#define PIN_BUZZER     33
#define PIN_LED_RED    25
#define PIN_LED_WIFI   2

// ==================== CONFIGURATION ====================
#define MATRIX_ROWS 8
#define MATRIX_COLS 8
#define NUM_PIXELS (MATRIX_ROWS * MATRIX_COLS)

#define LDR_DARK_WHEN_HIGH true  // Set after testing YOUR module

#define DETERRENT_DURATION_MS 5000
#define RADAR_CAUTION_MS 2000    // Time radar alone triggers caution
#define RADAR_DEBOUNCE_MS 80     // Debounce / stability window for RCWL-0516
#define TRIGGER_COOLDOWN_MS 3000
#define STATUS_PUBLISH_INTERVAL_MS 5000
#define WIFI_RETRY_INTERVAL_MS 30000
#define BUTTON_DEBOUNCE_MS 50
#define BUTTON_ACK_MS 300
#define BUTTON_ACK_BRIGHTNESS 40

#define SIREN_MIN_HZ 800
#define SIREN_MAX_HZ 2400
#define SIREN_SWEEP_MS 400

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
WiFiClient espClient;
PubSubClient mqttClient(espClient);

// Small MAX7219 driver using shiftOut so it works on ESP32 without AVR headers.
// Provides a subset of the Adafruit_NeoPixel-like API used by the rest of this
// sketch (setPixelColor, setBrightness, show, Color). This keeps the existing
// drawing functions intact while driving a single 8x8 MAX7219 (1088AS) module.
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
    }

    void clear() {
      for (int i = 0; i < 8; ++i) {
        rows[i] = 0x00;
        writeRegister(i + 1, 0x00);
      }
    }

    // Accept 0-255 like NeoPixel and map to MAX7219 0-15
    void setBrightness(int b) {
      if (b < 0) b = 0; if (b > 255) b = 255;
      intensity = map(b, 0, 255, 0, 15) & 0x0F;
      setIntensity(intensity);
    }

    // MAX7219 updates immediately; show is a no-op to match NeoPixel API
    void show() { }

    // index: 0..63 mapping row-major (row*8 + col)
    void setPixelColor(int index, uint32_t color) {
      int row = index / MATRIX_COLS;
      int col = index % MATRIX_COLS;
      if (row < 0 || row >= MATRIX_ROWS || col < 0 || col >= MATRIX_COLS) return;

      if (color != 0) rows[row] |= (1 << col);
      else rows[row] &= ~(1 << col);

      writeRegister(row + 1, rows[row]);
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
unsigned long lastStatusPublish = 0;
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

// Button debouncing
int lastButtonReading = HIGH;
int stableButtonState = HIGH;
unsigned long lastButtonChangeTime = 0;

// Button ACK animation
bool buttonAckActive = false;
unsigned long buttonAckStart = 0;

// Matrix brightness control (auto-adjusted by LDR)
int matrixBrightness = 60;

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

  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_LED_RED, LOW);
  digitalWrite(PIN_LED_WIFI, LOW);

  // Initialize 8x8 LED matrix
  matrix.begin();
  matrix.clear();
  matrix.setBrightness(60);
  matrix.show();

  // WiFi setup
  currentState = STATE_BOOTING;
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  startWiFiConnection();

  // MQTT setup
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setSocketTimeout(2);
  mqttClient.setCallback(mqttCallback);

  Serial.println("✓ Hardware initialized");
  Serial.println("✓ Type 'help' for serial test commands\n");
}

// ==========================================================
// MAIN LOOP
// ==========================================================
void loop() {
  handleSerialTestMode();
  handleWiFiAndMQTT();

  bool isDark = readIsDark();
  armed = armOverride ? armOverrideValue : isDark;

  handleRadarSensor();
  handlePIRSensor();
  handleButton();
  updateDeterrent();
  updateThreatLevel();
  updateSystemStateIfIdle();
  // Update brightness BEFORE rendering so per-state breathing effects can change global intensity
  updateMatrixBrightness();
  updateMatrixDisplay();

  unsigned long now = millis();
  if (now - lastStatusPublish > STATUS_PUBLISH_INTERVAL_MS) {
    publishStatus();
    lastStatusPublish = now;
  }
}

// ==========================================================
// LDR - LIGHT LEVEL DETECTION
// ==========================================================
bool readIsDark() {
  int raw = digitalRead(PIN_LDR);
  bool rawHigh = (raw == HIGH);
  return LDR_DARK_WHEN_HIGH ? rawHigh : !rawHigh;
}

void updateMatrixBrightness() {
  // Auto-adjust matrix brightness based on ambient light
  // Darker environment = lower brightness to avoid glare
  int raw = digitalRead(PIN_LDR);
  bool isDark = readIsDark();
  
  if (isDark) {
    matrixBrightness = 40;  // Reduce brightness in darkness
  } else {
    matrixBrightness = 120; // Increase in daylight
  }

  if (deterrentActive || currentState == STATE_ALERT) {
    matrixBrightness = 255; // Full brightness during alert
  }

  matrix.setBrightness(matrixBrightness);
}

// ==========================================================
// SENSOR HANDLING - RADAR (RCWL-0516)
// ==========================================================
void handleRadarSensor() {
  // Read raw input and debounce to produce a stableRadarState suitable for logic
  int radarRawSample = digitalRead(PIN_RADAR);
  if (radarRawSample != lastRadarRaw) {
    lastRadarRaw = radarRawSample;
    lastRadarRawChange = millis();
  }

  bool radarTransition = false;
  // Accept a change only if it has been stable for the debounce window
  if (lastRadarRaw != stableRadarState && (millis() - lastRadarRawChange) > RADAR_DEBOUNCE_MS) {
    stableRadarState = lastRadarRaw;
    radarTransition = true;
    Serial.print("📡 RADAR: Stable -> "); Serial.println(stableRadarState == HIGH ? "HIGH" : "LOW");

    // Publish immediate radar event for quicker remote visibility
    if (mqttClient.connected()) {
      mqttClient.publish(TOPIC_RADAR, stableRadarState == HIGH ? "1" : "0");
    }
  }

  // Use debounced/stable state for threat evaluation
  if (armed && stableRadarState == HIGH) {
    if (radarTransition) {
      radarActiveStart = millis();
      radarCautionTriggered = false;
      Serial.println("📡 RADAR: Motion detected (stable)!");
    }

    // Trigger CAUTION after RADAR_CAUTION_MS of continuous stable radar
    unsigned long radarDuration = millis() - radarActiveStart;
    if (!radarCautionTriggered && radarDuration > RADAR_CAUTION_MS) {
      radarCautionTriggered = true;
      currentThreatLevel = THREAT_CAUTION;
      Serial.println("📡 RADAR: Sustained motion - CAUTION level");
      if (mqttClient.connected()) {
        char buf[4]; snprintf(buf, sizeof(buf), "%d", currentThreatLevel);
        mqttClient.publish(TOPIC_THREAT_LEVEL, buf);
      }
    }
  }
  else if (stableRadarState == LOW && radarTransition) {
    Serial.println("📡 RADAR: Clear (stable)");
    radarCautionTriggered = false;
    if (currentThreatLevel == THREAT_CAUTION && lastPirState == LOW) {
      currentThreatLevel = THREAT_CLEAR;
    }
  }

  lastRadarState = stableRadarState;
}

// ==========================================================
// SENSOR HANDLING - PIR (Traditional Motion)
// ==========================================================
void handlePIRSensor() {
  int pirState = digitalRead(PIN_PIR);
  bool pirTransition = (pirState != lastPirState);

  if (armed && pirState == HIGH && lastPirState == LOW) {
    unsigned long now = millis();
    if (now - lastTriggerTime > TRIGGER_COOLDOWN_MS) {
      // PIR fired! Check if radar is also active for threat level
      if (lastRadarState == HIGH) {
        currentThreatLevel = THREAT_DANGER;
        Serial.println("🚶 PIR: Motion + RADAR active - DANGER level");
      } else {
        currentThreatLevel = THREAT_CAUTION;
        Serial.println("🚶 PIR: Motion detected");
      }
      
      triggerDeterrent();
      lastTriggerTime = now;
      
      if (mqttClient.connected()) {
        mqttClient.publish(TOPIC_ALERT, "1");
      }
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
  deterrentActive = true;
  deterrentStartTime = millis();
  currentThreatLevel = THREAT_ALERT;
  currentState = STATE_ALERT;
  digitalWrite(PIN_LED_RED, HIGH);
  Serial.println("🚨 DETERRENT TRIGGERED!");
}

void updateSiren() {
  unsigned long elapsed = millis() - deterrentStartTime;
  unsigned long sweepPhase = elapsed % SIREN_SWEEP_MS;
  float t = (float)sweepPhase / SIREN_SWEEP_MS;
  float ramp = (t < 0.5) ? (t * 2) : (2 - t * 2);
  int baseFreq = SIREN_MIN_HZ + (int)(ramp * (SIREN_MAX_HZ - SIREN_MIN_HZ));

  // Warble between baseFreq and a slightly higher frequency to make the siren more urgent
  int warbleFreq = baseFreq + ((elapsed / 300) % 2 == 0 ? 0 : 300);
  // Create short gaps for a pulsing effect (makes the sound more attention-grabbing)
  unsigned long pulseCycle = elapsed % 1000;
  if (pulseCycle < 800) {
    tone(PIN_BUZZER, min(warbleFreq, SIREN_MAX_HZ));
  } else {
    noTone(PIN_BUZZER);
  }
}

void updateDeterrent() {
  if (!deterrentActive) return;
  
  unsigned long elapsed = millis() - deterrentStartTime;
  updateSiren();
  
  if (elapsed > DETERRENT_DURATION_MS) {
    deterrentActive = false;
    digitalWrite(PIN_LED_RED, LOW);
    noTone(PIN_BUZZER);
    Serial.println("✓ Deterrent cycle complete");
  }
}

void updateSystemStateIfIdle() {
  if (deterrentActive) {
    currentState = STATE_ALERT;
    return;
  }

  if (currentState == STATE_BOOTING) {
    if (mqttClient.connected()) {
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
void setPixelXY(int row, int col, uint32_t color) {
  if (row < 0 || row >= MATRIX_ROWS || col < 0 || col >= MATRIX_COLS) return;
  int index = row * MATRIX_COLS + col;
  matrix.setPixelColor(index, color);
}

void drawHorizontalLine(int row, uint32_t color) {
  for (int col = 0; col < MATRIX_COLS; col++) {
    setPixelXY(row, col, color);
  }
}

void drawVerticalLine(int col, uint32_t color) {
  for (int row = 0; row < MATRIX_ROWS; row++) {
    setPixelXY(row, col, color);
  }
}

void drawBorder(uint32_t color) {
  drawHorizontalLine(0, color);
  drawHorizontalLine(7, color);
  drawVerticalLine(0, color);
  drawVerticalLine(7, color);
}

void drawCrosshair(uint32_t color) {
  drawHorizontalLine(3, color);
  drawHorizontalLine(4, color);
  drawVerticalLine(3, color);
  drawVerticalLine(4, color);
}

void drawBootingSpinner() {
  // Rotating perimeter animation
  static const int perim[28][2] = {
    {0,0},{0,1},{0,2},{0,3},{0,4},{0,5},{0,6},{0,7},
    {1,7},{2,7},{3,7},{4,7},{5,7},{6,7},{7,7},
    {7,6},{7,5},{7,4},{7,3},{7,2},{7,1},{7,0},
    {6,0},{5,0},{4,0},{3,0},{2,0},{1,0}
  };
  int pos = (millis() / 90) % 28;
  uint32_t blue = matrix.Color(0, 60, 255);
  setPixelXY(perim[pos][0], perim[pos][1], blue);
}

void drawDisarmedIdle() {
  // Sun glyph - system disarmed
  uint32_t yellow = matrix.Color(100, 80, 0);
  setPixelXY(3, 3, yellow); setPixelXY(3, 4, yellow);
  setPixelXY(4, 3, yellow); setPixelXY(4, 4, yellow);
  setPixelXY(1, 3, yellow); setPixelXY(1, 4, yellow);
  setPixelXY(6, 3, yellow); setPixelXY(6, 4, yellow);
  setPixelXY(3, 1, yellow); setPixelXY(4, 1, yellow);
  setPixelXY(3, 6, yellow); setPixelXY(4, 6, yellow);
}

void drawArmedClear() {
  // Breathing moon - all quiet
  float phase = (millis() % 3000) / 3000.0;
  int b = 40 + (int)(60 * (phase < 0.5 ? phase * 2 : (1 - phase) * 2));
  // Set global intensity to create breathing effect on MAX7219
  matrix.setBrightness(b);

  uint32_t blue = matrix.Color(20, 50, 255);
  int crescent[][2] = {{2,4},{2,5},{3,3},{3,6},{4,3},{4,6},{5,3},{5,6},{6,4},{6,5}};
  for (auto &p : crescent) setPixelXY(p[0], p[1], blue);
}

void drawArmedCaution() {
  // Yellow border - radar active
  uint32_t yellow = matrix.Color(255, 200, 0);
  drawBorder(yellow);
  
  // Pulsing inner dots
  unsigned long pulse = (millis() / 300) % 2;
  if (pulse) {
    uint32_t orange = matrix.Color(255, 150, 0);
    setPixelXY(3, 3, orange);
    setPixelXY(3, 4, orange);
    setPixelXY(4, 3, orange);
    setPixelXY(4, 4, orange);
  }
}

void drawArmedDanger() {
  // Orange frame with inner warning - PIR + Radar
  uint32_t orange = matrix.Color(255, 100, 0);
  drawBorder(orange);
  
  // Flashing crosshair
  if ((millis() / 200) % 2) {
    drawCrosshair(orange);
  }
}

void drawAlert() {
  // Animated red eyes - scanning and pulsing for urgency
  uint32_t red = matrix.Color(255, 0, 0);
  unsigned long t = millis();
  // Scanning offset cycles 0..3
  int scan = (t / 180) % 4;
  // Pulsing visibility (on most of the time, short off gaps create blink)
  bool visible = (t / 120) % 5 != 0;
  if (!visible) return;

  // Eyes positions move left-right within a small window
  int leftCol = 2 + (scan % 3);   // 2..4
  int rightCol = 5 - (scan % 3);  // 5..3

  setPixelXY(2, leftCol, red); setPixelXY(2, rightCol, red);
  setPixelXY(3, leftCol, red); setPixelXY(3, rightCol, red);
  setPixelXY(4, leftCol-1, red); setPixelXY(4, rightCol+1, red);
  setPixelXY(5, leftCol-1, red); setPixelXY(5, rightCol+1, red);
  setPixelXY(6, leftCol, red); setPixelXY(6, rightCol, red);
}

void drawButtonAckOverlay() {
  if (millis() - buttonAckStart > BUTTON_ACK_MS) {
    buttonAckActive = false;
    return;
  }
  
  // White flash confirmation
  uint32_t white = matrix.Color(255, 255, 255);
  for (int i = 0; i < NUM_PIXELS; i++) {
    matrix.setPixelColor(i, white);
  }
}

void updateMatrixDisplay() {
  matrix.clear();

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

  matrix.show();
}

// ==========================================================
// WiFi & MQTT
// ==========================================================
void handleWiFiAndMQTT() {
  if (WiFi.status() != WL_CONNECTED) {
    digitalWrite(PIN_LED_WIFI, (millis() / 300) % 2);
    startWiFiConnection();
  } else if (!mqttClient.connected()) {
    digitalWrite(PIN_LED_WIFI, (millis() / 150) % 2);
    connectMQTT();
  } else {
    digitalWrite(PIN_LED_WIFI, HIGH);
    mqttClient.loop();
  }
}

void startWiFiConnection() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (lastWiFiAttempt != 0 && millis() - lastWiFiAttempt < WIFI_RETRY_INTERVAL_MS) return;
  lastWiFiAttempt = millis();
  
  Serial.print("📡 Connecting to WiFi...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void connectMQTT() {
  if (WiFi.status() != WL_CONNECTED) return;
  static unsigned long lastAttempt = 0;
  if (millis() - lastAttempt < 15000) return;
  lastAttempt = millis();

  Serial.print("📡 Connecting to MQTT broker...");
  bool connected = mqttClient.connect(MQTT_CLIENT_ID, MQTT_USER, MQTT_PASS,
                                       TOPIC_ONLINE, 0, true, "0");
  if (connected) {
    Serial.println("✓ Connected");
    mqttClient.publish(TOPIC_ONLINE, "1", true);
    mqttClient.subscribe(TOPIC_CMD_DETERRENT);
    mqttClient.subscribe(TOPIC_CMD_ARM);
  } else {
    Serial.print(" Failed (rc="); Serial.print(mqttClient.state()); Serial.println(")");
  }
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String msg;
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  msg.trim();
  String t = String(topic);

  if (t == TOPIC_CMD_DETERRENT) {
    if (msg == "trigger") triggerDeterrent();
  } else if (t == TOPIC_CMD_ARM) {
    if (msg == "auto") armOverride = false;
    else if (msg == "on") { armOverride = true; armOverrideValue = true; }
    else if (msg == "off") { armOverride = true; armOverrideValue = false; }
  }
}

void publishStatus() {
  if (!mqttClient.connected()) return;

  char threatStr[2];
  snprintf(threatStr, sizeof(threatStr), "%d", currentThreatLevel);

  mqttClient.publish(TOPIC_PIR, lastPirState == HIGH ? "1" : "0");
  mqttClient.publish(TOPIC_RADAR, lastRadarState == HIGH ? "1" : "0");
  mqttClient.publish(TOPIC_LIGHT, readIsDark() ? "1" : "0");
  mqttClient.publish(TOPIC_THREAT_LEVEL, threatStr);
  mqttClient.publish(TOPIC_ARMED, armed ? "1" : "0");
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
    updateSiren();
    delay(25);
  }

  deterrentActive = savedDetActive;
  deterrentStartTime = savedDeterrentStart;
  noTone(PIN_BUZZER);
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

void printSystemStatus() {
  Serial.println("\n╔════════════════════════════════════╗");
  Serial.println("║         SYSTEM STATUS REPORT       ║");
  Serial.println("╠════════════════════════════════════╣");

  Serial.print("║ WiFi:           ");
  Serial.println(WiFi.status() == WL_CONNECTED ? "✓ Connected  ║" : "✗ Offline    ║");

  Serial.print("║ MQTT:           ");
  Serial.println(mqttClient.connected() ? "✓ Connected  ║" : "✗ Disconnected ║");

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