/*
  ==========================================================
   SMART COOP PREDATOR DETERRENT — ESP32 Firmware (v3)
  ==========================================================
  Hardware (board-esp32-devkit-c-v4):
    - PIR motion sensor      -> GPIO 27  (3.3V logic output required — see below)
    - Pushbutton (manual)    -> GPIO 26 (INPUT_PULLUP)
    - LDR module, DO pin     -> GPIO 34 (DIGITAL read — this module has a
                                comparator onboard, not a raw analog pin)
    - WS2812 8x8 matrix      -> GPIO 5  (DIN only; DOUT unused, it's just for
                                daisy-chaining a second matrix, leave it disconnected)
    - Buzzer                 -> GPIO 33
    - Deterrent LED (red)    -> GPIO 25
    - WiFi status LED (grn)  -> GPIO 2

  NOTE: the door-lock servo has been removed — no servo hardware in this
  build. All door/servo code, MQTT topics, and matrix "door moving" state
  from earlier versions have been stripped out.

  Connectivity: WiFi + MQTT (PubSubClient), private/self-hosted broker.

  ----------------------------------------------------------
  REAL-HARDWARE WIRING WARNING (read before you wire this up)
  ----------------------------------------------------------
  ESP32 GPIO pins are 3.3V logic and are NOT 5V tolerant.
    - PIR OUT connects directly to GPIO27 only when the PIR's OUT
      signal is 3.3V. The common HC-SR501 outputs 3.3V even when
      powered from 5V. Verify your exact module before wiring.
      If it outputs 5V, use a proper 3.3V logic-level shifter;
      ESP32 GPIO pins are not 5V tolerant.
    - LDR module is powered from 3V3, and its DO pin is a
      digital 0/3.3V output already, safe as-is.
    - Matrix DIN has a 330 ohm series resistor for signal
      integrity; keep wiring short (<20cm) between ESP32 and
      matrix for reliable WS2812 timing at 3.3V logic.

  ----------------------------------------------------------
  LDR POLARITY — YOU MUST CHECK THIS ON YOUR REAL MODULE
  ----------------------------------------------------------
  Comparator-based LDR modules (LM393-style, with a trimmer screw)
  are NOT standardized on which state means "dark." Some output
  HIGH when dark, others output LOW when dark. There is no way to
  know this without testing your specific board.

  HOW TO CHECK: upload this sketch, open Serial Monitor, type
  "status", and:
    - cover the LDR fully -> note whether it prints raw=1 or raw=0
    - shine a light on it -> note the other value
  Then set LDR_DARK_WHEN_HIGH below to match what you observed:
    true  -> raw reads HIGH when covered/dark
    false -> raw reads LOW when covered/dark
  If you skip this step, arming logic will run backwards (exactly
  the "covered=bright, lit=dark" symptom from your bench test).
  ----------------------------------------------------------

  ----------------------------------------------------------
  BUZZER — 2-PIN PASSIVE vs 3-PIN ACTIVE MODULE
  ----------------------------------------------------------
  If your buzzer has 2 pins (a bare piezo disc, no polarity): wire
  as shown in diagram.json — GND to the shared ground rail, signal
  pin straight to GPIO33. tone() will drive it directly.

  If your buzzer is a 3-pin MODULE (small green PCB with VCC/GND/I-O
  labeled pins — an "active buzzer module"): wire VCC to 5V or 3.3V
  per its label, GND to ground, and ONLY the signal/I-O pin to
  GPIO33. Some active modules ignore tone()'s frequency and just
  need a plain HIGH to buzz — use the "buzzer2" serial test command
  below to check a plain digitalWrite() pulse if "buzzer" produces
  no sound.

  SERIAL TEST MODE
  ----------------------------------------------------------
  Type these into the Serial Monitor (115200 baud) to bench-test
  each part BEFORE trusting the full system:
    led      -> flashes the red deterrent LED
    buzzer   -> plays the alarm siren via tone() for 2 seconds
    buzzer2  -> plain digitalWrite HIGH pulse for 1s (active-buzzer fallback test)
    matrix   -> cycles through all matrix display states
    status   -> prints PIR/LDR raw + interpreted state + WiFi/MQTT

  MQTT Topic Map (for the app/software team)
  --------------------------------------------------------
  PUBLISH (device -> app):
    coop/status/pir        "0" | "1"            motion state
    coop/status/light      "0" | "1"            LDR raw digital reading
    coop/status/armed      "0" | "1"            armed (dark) or not
    coop/alert/predator    "1"                  fired once per trigger event
    coop/status/online     "1" (retained), LWT "0"

  SUBSCRIBE (app -> device):
    coop/cmd/deterrent     "trigger"            force-fire lights/buzzer
    coop/cmd/arm           "auto" | "on" | "off" arm mode override
  ==========================================================
*/

#include <WiFi.h>
#include <PubSubClient.h>
#include <Adafruit_NeoPixel.h>

// ---------------- USER CONFIG ----------------
const char* WIFI_SSID     = "P4X";
const char* WIFI_PASSWORD = "dvorack1844l5";

const char* MQTT_BROKER   = "192.168.245.160";
const int   MQTT_PORT     = 1883;
const char* MQTT_CLIENT_ID= "smart_coop_esp32";
const char* MQTT_USER     = "coop_device";
const char* MQTT_PASS     = "password123";

const char* TOPIC_PIR        = "coop/status/pir";
const char* TOPIC_LIGHT      = "coop/status/light";
const char* TOPIC_ARMED      = "coop/status/armed";
const char* TOPIC_ALERT      = "coop/alert/predator";
const char* TOPIC_ONLINE     = "coop/status/online";

const char* TOPIC_CMD_DETERRENT = "coop/cmd/deterrent";
const char* TOPIC_CMD_ARM       = "coop/cmd/arm";

// ---------------- PIN CONFIG ----------------
#define PIN_PIR        27
#define PIN_BUTTON     26
#define PIN_LDR        34
#define PIN_MATRIX     5
#define PIN_BUZZER     33
#define PIN_LED_RED    25
#define PIN_LED_WIFI   2

// ---------------- LDR POLARITY — SET THIS AFTER TESTING YOUR MODULE ----------------
bool LDR_DARK_WHEN_HIGH = true; // flip to false if your test shows the opposite

#define MATRIX_ROWS 8
#define MATRIX_COLS 8
#define NUM_PIXELS (MATRIX_ROWS * MATRIX_COLS)

#define DETERRENT_DURATION_MS 5000
#define TRIGGER_COOLDOWN_MS 3000
#define STATUS_PUBLISH_INTERVAL_MS 5000
#define WIFI_RETRY_INTERVAL_MS 30000
#define BUTTON_DEBOUNCE_MS 50
#define BUTTON_ACK_MS 180
#define BUTTON_ACK_BRIGHTNESS 25

#define SIREN_MIN_HZ 800
#define SIREN_MAX_HZ 2400
#define SIREN_SWEEP_MS 400

// ---------------- GLOBAL OBJECTS ----------------
WiFiClient espClient;
PubSubClient mqttClient(espClient);
Adafruit_NeoPixel matrix(NUM_PIXELS, PIN_MATRIX, NEO_GRB + NEO_KHZ800);

// ---------------- SYSTEM STATE ----------------
enum SystemState { STATE_BOOTING, STATE_DISARMED_IDLE, STATE_ARMED_IDLE, STATE_ALERT };
SystemState currentState = STATE_BOOTING;

bool armed = false;
bool armOverride = false;
bool armOverrideValue = false;

bool deterrentActive = false;
unsigned long deterrentStartTime = 0;
unsigned long lastTriggerTime = 0;
unsigned long lastStatusPublish = 0;
unsigned long lastWiFiAttempt = 0;

int lastPirState = LOW;

int lastButtonReading = HIGH;
int stableButtonState = HIGH;
unsigned long lastButtonChangeTime = 0;

bool buttonAckActive = false;
unsigned long buttonAckStart = 0;

// ==========================================================
void setup() {
  Serial.begin(115200);

  pinMode(PIN_PIR, INPUT);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_LDR, INPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_LED_WIFI, OUTPUT);

  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_LED_RED, LOW);
  digitalWrite(PIN_LED_WIFI, LOW);

  matrix.begin();
  matrix.clear();
  matrix.show();

  currentState = STATE_BOOTING;
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  startWiFiConnection();
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setSocketTimeout(2);
  mqttClient.setCallback(mqttCallback);

  Serial.println("Smart Coop Predator Deterrent ready. Type 'status' to check sensors.");
}

// ==========================================================
void loop() {
  handleSerialTestMode();
  handleWiFiAndMQTT();

  bool isDark = readIsDark();
  armed = armOverride ? armOverrideValue : isDark;

  handlePIR();
  handleButton();
  updateDeterrent();
  updateSystemStateIfIdle();
  updateMatrixDisplay();

  unsigned long now = millis();
  if (now - lastStatusPublish > STATUS_PUBLISH_INTERVAL_MS) {
    publishStatus(digitalRead(PIN_PIR), isDark);
    lastStatusPublish = now;
  }
}

// ==========================================================
// LDR (digital DO pin, polarity configurable)
// ==========================================================
bool readIsDark() {
  int raw = digitalRead(PIN_LDR);
  bool rawHigh = (raw == HIGH);
  return LDR_DARK_WHEN_HIGH ? rawHigh : !rawHigh;
}

// ==========================================================
// WIFI / MQTT
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
  Serial.print("Connecting to WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.println(" (continuing sensor protection while it connects)");
}

void connectMQTT() {
  if (WiFi.status() != WL_CONNECTED) return;
  static unsigned long lastAttempt = 0;
  if (millis() - lastAttempt < 15000) return;
  lastAttempt = millis();

  Serial.print("Connecting to MQTT broker...");
  bool connected = mqttClient.connect(MQTT_CLIENT_ID, MQTT_USER, MQTT_PASS,
                                       TOPIC_ONLINE, 0, true, "0");
  if (connected) {
    Serial.println("connected.");
    mqttClient.publish(TOPIC_ONLINE, "1", true);
    mqttClient.subscribe(TOPIC_CMD_DETERRENT);
    mqttClient.subscribe(TOPIC_CMD_ARM);
  } else {
    Serial.print("failed, rc=");
    Serial.println(mqttClient.state());
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

void publishStatus(int pirState, bool isDark) {
  if (!mqttClient.connected()) return;
  mqttClient.publish(TOPIC_PIR, pirState == HIGH ? "1" : "0");
  mqttClient.publish(TOPIC_LIGHT, isDark ? "1" : "0");
  mqttClient.publish(TOPIC_ARMED, armed ? "1" : "0");
}

// ==========================================================
// SENSORS: PIR + BUTTON (debounced, edge-triggered)
// ==========================================================
void handlePIR() {
  int pirState = digitalRead(PIN_PIR);
  if (armed && pirState == HIGH && lastPirState == LOW) {
    unsigned long now = millis();
    if (now - lastTriggerTime > TRIGGER_COOLDOWN_MS) {
      triggerDeterrent();
      lastTriggerTime = now;
      if (mqttClient.connected()) mqttClient.publish(TOPIC_ALERT, "1");
    }
  }
  lastPirState = pirState;
}

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
        triggerDeterrent();
        Serial.println("Manual trigger via button.");
      }
    }
  }
  lastButtonReading = reading;
}

// ==========================================================
// DETERRENT (lights + siren)
// ==========================================================
void triggerDeterrent() {
  deterrentActive = true;
  deterrentStartTime = millis();
  currentState = STATE_ALERT;
  digitalWrite(PIN_LED_RED, HIGH);
  Serial.println("Deterrent triggered!");
}

void updateSiren() {
  unsigned long elapsed = millis() - deterrentStartTime;
  unsigned long phase = elapsed % SIREN_SWEEP_MS;
  float t = (float)phase / SIREN_SWEEP_MS;
  float ramp = (t < 0.5) ? (t * 2) : (2 - t * 2);
  int freq = SIREN_MIN_HZ + (int)(ramp * (SIREN_MAX_HZ - SIREN_MIN_HZ));
  tone(PIN_BUZZER, freq);
}

void updateDeterrent() {
  if (!deterrentActive) return;
  unsigned long elapsed = millis() - deterrentStartTime;
  updateSiren();
  if (elapsed > DETERRENT_DURATION_MS) {
    deterrentActive = false;
    digitalWrite(PIN_LED_RED, LOW);
    noTone(PIN_BUZZER);
    Serial.println("Deterrent cycle ended.");
  }
}

void updateSystemStateIfIdle() {
  if (deterrentActive) {
    currentState = STATE_ALERT;
    return;
  }
  if (currentState == STATE_BOOTING) {
    if (mqttClient.connected()) {
      currentState = armed ? STATE_ARMED_IDLE : STATE_DISARMED_IDLE;
    }
    return;
  }
  currentState = armed ? STATE_ARMED_IDLE : STATE_DISARMED_IDLE;
}

// ==========================================================
// MATRIX DISPLAY (the system's "face")
// ==========================================================
void setPixelXY(int row, int col, uint32_t color) {
  int index = row * MATRIX_COLS + col;
  if (index >= 0 && index < NUM_PIXELS) {
    matrix.setPixelColor(index, color);
  }
}

void updateMatrixDisplay() {
  matrix.clear();
  switch (currentState) {
    case STATE_BOOTING:       drawBootingSpinner(); break;
    case STATE_DISARMED_IDLE: drawSunGlyph();        break;
    case STATE_ARMED_IDLE:    drawBreathingMoon();   break;
    case STATE_ALERT:         drawAlertEyes();       break;
  }
  if (buttonAckActive) drawButtonAckOverlay();
  matrix.show();
}

void drawBootingSpinner() {
  matrix.setBrightness(60);
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

void drawSunGlyph() {
  matrix.setBrightness(25);
  uint32_t dimYellow = matrix.Color(60, 50, 0);
  setPixelXY(3,3, dimYellow); setPixelXY(3,4, dimYellow);
  setPixelXY(4,3, dimYellow); setPixelXY(4,4, dimYellow);
  setPixelXY(1,3, dimYellow); setPixelXY(1,4, dimYellow);
  setPixelXY(6,3, dimYellow); setPixelXY(6,4, dimYellow);
  setPixelXY(3,1, dimYellow); setPixelXY(4,1, dimYellow);
  setPixelXY(3,6, dimYellow); setPixelXY(4,6, dimYellow);
}

void drawBreathingMoon() {
  float phase = (millis() % 3000) / 3000.0;
  int brightness = 8 + (int)(22 * (phase < 0.5 ? phase * 2 : (1 - phase) * 2));
  matrix.setBrightness(brightness);
  uint32_t blue = matrix.Color(20, 40, 255);
  int crescent[][2] = {{2,4},{2,5},{3,3},{3,6},{4,3},{4,6},{5,3},{5,6},{6,4},{6,5}};
  for (auto &p : crescent) setPixelXY(p[0], p[1], blue);
}

void drawAlertEyes() {
  // A full-white 8x8 frame at full brightness can exceed 3A. Keep this
  // acknowledgement deliberately dim even when an external 5V supply is used.
  matrix.setBrightness(BUTTON_ACK_BRIGHTNESS);
  unsigned long elapsed = millis() - deterrentStartTime;
  bool on = (elapsed / 150) % 2 == 0;
  if (!on) return;
  uint32_t red = matrix.Color(255, 0, 0);
  setPixelXY(2,2, red); setPixelXY(2,5, red);
  setPixelXY(3,2, red); setPixelXY(3,5, red);
}

void drawButtonAckOverlay() {
  if (millis() - buttonAckStart > BUTTON_ACK_MS) {
    buttonAckActive = false;
    return;
  }
  matrix.setBrightness(255);
  uint32_t white = matrix.Color(255, 255, 255);
  for (int i = 0; i < NUM_PIXELS; i++) matrix.setPixelColor(i, white);
}

// ==========================================================
// SERIAL TEST MODE — bench-test each part in isolation
// ==========================================================
void handleSerialTestMode() {
  if (!Serial.available()) return;
  String cmd = Serial.readStringUntil('\n');
  cmd.trim();
  cmd.toLowerCase();

  if (cmd == "led") {
    Serial.println("[TEST] Flashing red LED 3x...");
    for (int i = 0; i < 3; i++) {
      digitalWrite(PIN_LED_RED, HIGH); delay(200);
      digitalWrite(PIN_LED_RED, LOW);  delay(200);
    }
    Serial.println("[TEST] LED test done.");
  }
  else if (cmd == "buzzer") {
    Serial.println("[TEST] Playing siren via tone() for 2s...");
    unsigned long start = millis();
    while (millis() - start < 2000) {
      unsigned long elapsed = millis() - start;
      unsigned long phase = elapsed % SIREN_SWEEP_MS;
      float t = (float)phase / SIREN_SWEEP_MS;
      float ramp = (t < 0.5) ? (t * 2) : (2 - t * 2);
      int freq = SIREN_MIN_HZ + (int)(ramp * (SIREN_MAX_HZ - SIREN_MIN_HZ));
      tone(PIN_BUZZER, freq);
      delay(5);
    }
    noTone(PIN_BUZZER);
    Serial.println("[TEST] Buzzer (tone) test done. Heard nothing? Try 'buzzer2'.");
  }
  else if (cmd == "buzzer2") {
    Serial.println("[TEST] Plain digitalWrite HIGH pulse for 1s (active-buzzer fallback)...");
    digitalWrite(PIN_BUZZER, HIGH);
    delay(1000);
    digitalWrite(PIN_BUZZER, LOW);
    Serial.println("[TEST] buzzer2 test done. Still nothing? Check wiring/polarity/pin.");
  }
  else if (cmd == "matrix") {
    Serial.println("[TEST] Cycling matrix states (booting/sun/moon/eyes)...");
    SystemState saved = currentState;
    SystemState sequence[] = {STATE_BOOTING, STATE_DISARMED_IDLE, STATE_ARMED_IDLE, STATE_ALERT};
    for (int s = 0; s < 4; s++) {
      currentState = sequence[s];
      unsigned long segStart = millis();
      while (millis() - segStart < 1500) {
        updateMatrixDisplay();
        delay(20);
      }
    }
    matrix.clear(); matrix.show();
    currentState = saved;
    Serial.println("[TEST] Matrix test done. Nothing lit up? Check VCC/GND/DIN order and try 5V power.");
  }
  else if (cmd == "status") {
    int ldrRaw = digitalRead(PIN_LDR);
    bool isDark = readIsDark();
    Serial.println("---- SYSTEM STATUS ----");
    Serial.print("PIR raw:        "); Serial.println(digitalRead(PIN_PIR));
    Serial.print("LDR raw digital:"); Serial.println(ldrRaw);
    Serial.print("Interpreted:    "); Serial.println(isDark ? "DARK" : "LIGHT");
    Serial.print("Armed:          "); Serial.println(armed ? "yes" : "no");
    Serial.print("WiFi:           "); Serial.println(WiFi.status() == WL_CONNECTED ? "connected" : "disconnected");
    Serial.print("MQTT:           "); Serial.println(mqttClient.connected() ? "connected" : "disconnected");
    Serial.println("-----------------------");
  }
  else {
    Serial.println("Unknown command. Try: led, buzzer, buzzer2, matrix, status");
  }
}
