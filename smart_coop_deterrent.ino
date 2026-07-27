/*
  ==========================================================
   SMART COOP PREDATOR DETERRENT — ESP32 Firmware (v2)
  ==========================================================
  Hardware (board-esp32-devkit-c-v4):
    - PIR motion sensor      -> GPIO 27
    - Pushbutton (manual)    -> GPIO 26 (INPUT_PULLUP)
    - LDR (light sensor)     -> GPIO 34 (ADC1, analog)
    - WS2812 8x8 matrix      -> GPIO 5
    - Buzzer                 -> GPIO 33
    - Deterrent LED (red)    -> GPIO 25
    - WiFi status LED (grn)  -> GPIO 2
    - Servo (coop door lock) -> GPIO 32

  Connectivity: WiFi + MQTT (PubSubClient), private/self-hosted broker.

  Libraries needed (see libraries.txt for Wokwi auto-install):
    - PubSubClient      by Nick O'Leary
    - Adafruit NeoPixel by Adafruit
    - ESP32Servo        by Kevin Harrington / John K. Bennett

  ----------------------------------------------------------
  MATRIX / HCI DESIGN
  ----------------------------------------------------------
  The 8x8 matrix acts as the system's "face" so a person glancing
  at the coop can read system health at a glance, without needing
  the app open:

    BOOTING         -> slow blue dot spinning around the border
    DISARMED_IDLE   -> dim static "sun" glyph   (daytime, not armed)
    ARMED_IDLE      -> soft breathing blue "moon" glyph (armed, calm)
    DOOR_MOVING     -> blinking yellow arrows, ~900ms transient
    ALERT           -> fast red strobing "eyes", full brightness
    (button press)  -> brief full-white flash overlay, then resumes

  All animations are non-blocking (millis()-based), so MQTT and
  sensor polling never stall waiting on a light show.

  MQTT Topic Map (for the app/software team)
  --------------------------------------------------------
  PUBLISH (device -> app):
    coop/status/pir        "0" | "1"            motion state
    coop/status/light      raw int 0-4095       LDR reading
    coop/status/armed      "0" | "1"            armed (dark) or not
    coop/status/door       "open" | "closed"    door position
    coop/alert/predator    "1"                  fired once per trigger event
    coop/status/online     "1" (retained), LWT "0"

  SUBSCRIBE (app -> device):
    coop/cmd/door          "open" | "close"     manual door control
    coop/cmd/deterrent     "trigger"            force-fire lights/buzzer
    coop/cmd/arm           "auto" | "on" | "off" arm mode override
  ==========================================================
*/

#include <WiFi.h>
#include <PubSubClient.h>
#include <Adafruit_NeoPixel.h>
#include <ESP32Servo.h>

// ---------------- USER CONFIG ----------------
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

const char* MQTT_BROKER   = "YOUR_BROKER_IP_OR_DOMAIN";
const int   MQTT_PORT     = 1883;
const char* MQTT_CLIENT_ID= "smart_coop_esp32";
const char* MQTT_USER     = "coop_device";
const char* MQTT_PASS     = "YOUR_STRONG_PASSWORD";

const char* TOPIC_PIR        = "coop/status/pir";
const char* TOPIC_LIGHT      = "coop/status/light";
const char* TOPIC_ARMED      = "coop/status/armed";
const char* TOPIC_DOOR       = "coop/status/door";
const char* TOPIC_ALERT      = "coop/alert/predator";
const char* TOPIC_ONLINE     = "coop/status/online";

const char* TOPIC_CMD_DOOR      = "coop/cmd/door";
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
#define PIN_SERVO      32

#define MATRIX_ROWS 8
#define MATRIX_COLS 8
#define NUM_PIXELS (MATRIX_ROWS * MATRIX_COLS)

#define LDR_DARK_THRESHOLD 1500

#define SERVO_OPEN_ANGLE   90
#define SERVO_CLOSED_ANGLE 0

#define DETERRENT_DURATION_MS 5000
#define TRIGGER_COOLDOWN_MS 3000
#define STATUS_PUBLISH_INTERVAL_MS 5000
#define BUTTON_DEBOUNCE_MS 50
#define DOOR_ANIM_MS 900
#define BUTTON_ACK_MS 180

// ---------------- GLOBAL OBJECTS ----------------
WiFiClient espClient;
PubSubClient mqttClient(espClient);
Adafruit_NeoPixel matrix(NUM_PIXELS, PIN_MATRIX, NEO_GRB + NEO_KHZ800);
Servo doorServo;

// ---------------- SYSTEM STATE ----------------
enum SystemState { STATE_BOOTING, STATE_DISARMED_IDLE, STATE_ARMED_IDLE, STATE_DOOR_MOVING, STATE_ALERT };
SystemState currentState = STATE_BOOTING;
SystemState stateBeforeDoorAnim = STATE_DISARMED_IDLE; // what to return to after door animation

bool armed = false;
bool armOverride = false;
bool armOverrideValue = false;
bool doorOpen = true;

bool deterrentActive = false;
unsigned long deterrentStartTime = 0;
unsigned long lastTriggerTime = 0;
unsigned long doorAnimStartTime = 0;
unsigned long lastStatusPublish = 0;

int lastPirState = LOW;

// Button debounce/edge tracking
int lastButtonReading = HIGH;
int stableButtonState = HIGH;
unsigned long lastButtonChangeTime = 0;

// Button press acknowledgement overlay (drawn on top of current state briefly)
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

  doorServo.attach(PIN_SERVO);
  doorServo.write(SERVO_OPEN_ANGLE);
  doorOpen = true;

  currentState = STATE_BOOTING;
  connectWiFi();
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);

  Serial.println("Smart Coop Predator Deterrent ready.");
}

// ==========================================================
void loop() {
  handleWiFiAndMQTT();

  int lightLevel = analogRead(PIN_LDR);
  bool isDark = (lightLevel < LDR_DARK_THRESHOLD);

  armed = armOverride ? armOverrideValue : isDark;

  handleDoorAutomation(isDark);
  handlePIR();
  handleButton();
  updateDeterrent();
  updateSystemStateIfIdle();
  updateMatrixDisplay();

  unsigned long now = millis();
  if (now - lastStatusPublish > STATUS_PUBLISH_INTERVAL_MS) {
    publishStatus(digitalRead(PIN_PIR), lightLevel);
    lastStatusPublish = now;
  }
}

// ==========================================================
// WIFI / MQTT
// ==========================================================
void handleWiFiAndMQTT() {
  if (WiFi.status() != WL_CONNECTED) {
    digitalWrite(PIN_LED_WIFI, (millis() / 300) % 2); // slow blink while disconnected
    connectWiFi();
    return;
  }
  if (!mqttClient.connected()) {
    digitalWrite(PIN_LED_WIFI, (millis() / 150) % 2); // faster blink while MQTT connecting
    connectMQTT();
  } else {
    digitalWrite(PIN_LED_WIFI, HIGH); // solid = fully connected
  }
  mqttClient.loop();
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.print("Connecting to WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi connected, IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi connection failed, will retry.");
  }
}

void connectMQTT() {
  if (WiFi.status() != WL_CONNECTED) return;
  static unsigned long lastAttempt = 0;
  if (millis() - lastAttempt < 2000) return; // non-blocking retry throttle
  lastAttempt = millis();

  Serial.print("Connecting to MQTT broker...");
  bool connected = mqttClient.connect(MQTT_CLIENT_ID, MQTT_USER, MQTT_PASS,
                                       TOPIC_ONLINE, 0, true, "0");
  if (connected) {
    Serial.println("connected.");
    mqttClient.publish(TOPIC_ONLINE, "1", true);
    mqttClient.subscribe(TOPIC_CMD_DOOR);
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

  if (t == TOPIC_CMD_DOOR) {
    if (msg == "open") openDoor();
    else if (msg == "close") closeDoor();
  } else if (t == TOPIC_CMD_DETERRENT) {
    if (msg == "trigger") triggerDeterrent();
  } else if (t == TOPIC_CMD_ARM) {
    if (msg == "auto") armOverride = false;
    else if (msg == "on") { armOverride = true; armOverrideValue = true; }
    else if (msg == "off") { armOverride = true; armOverrideValue = false; }
  }
}

void publishStatus(int pirState, int lightLevel) {
  if (!mqttClient.connected()) return;
  mqttClient.publish(TOPIC_PIR, pirState == HIGH ? "1" : "0");
  mqttClient.publish(TOPIC_LIGHT, String(lightLevel).c_str());
  mqttClient.publish(TOPIC_ARMED, armed ? "1" : "0");
  mqttClient.publish(TOPIC_DOOR, doorOpen ? "open" : "closed");
}

// ==========================================================
// DOOR CONTROL
// ==========================================================
void handleDoorAutomation(bool isDark) {
  if (isDark && doorOpen) {
    closeDoor();
  } else if (!isDark && !doorOpen) {
    openDoor();
  }
}

void openDoor() {
  doorServo.write(SERVO_OPEN_ANGLE);
  doorOpen = true;
  if (mqttClient.connected()) mqttClient.publish(TOPIC_DOOR, "open");
  startDoorAnimation();
  Serial.println("Door opened.");
}

void closeDoor() {
  doorServo.write(SERVO_CLOSED_ANGLE);
  doorOpen = false;
  if (mqttClient.connected()) mqttClient.publish(TOPIC_DOOR, "closed");
  startDoorAnimation();
  Serial.println("Door closed.");
}

void startDoorAnimation() {
  if (currentState != STATE_ALERT) {
    stateBeforeDoorAnim = currentState == STATE_DOOR_MOVING ? stateBeforeDoorAnim : currentState;
    currentState = STATE_DOOR_MOVING;
    doorAnimStartTime = millis();
  }
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
      if (stableButtonState == LOW) { // pressed (active LOW, INPUT_PULLUP)
        buttonAckActive = true;
        buttonAckStart = millis();
        triggerDeterrent(); // manual test/trigger, ignores arm state
        Serial.println("Manual trigger via button.");
      }
    }
  }
  lastButtonReading = reading;
}

// ==========================================================
// DETERRENT (lights + sound)
// ==========================================================
void triggerDeterrent() {
  deterrentActive = true;
  deterrentStartTime = millis();
  currentState = STATE_ALERT;
  digitalWrite(PIN_LED_RED, HIGH);
  tone(PIN_BUZZER, 2000);
  Serial.println("Deterrent triggered!");
}

void updateDeterrent() {
  if (!deterrentActive) return;
  unsigned long elapsed = millis() - deterrentStartTime;
  if (elapsed > DETERRENT_DURATION_MS) {
    deterrentActive = false;
    digitalWrite(PIN_LED_RED, LOW);
    noTone(PIN_BUZZER);
    Serial.println("Deterrent cycle ended.");
  }
}

// Decide the idle state (armed/disarmed) once transient states finish
void updateSystemStateIfIdle() {
  if (deterrentActive) {
    currentState = STATE_ALERT;
    return;
  }
  if (currentState == STATE_DOOR_MOVING) {
    if (millis() - doorAnimStartTime > DOOR_ANIM_MS) {
      currentState = armed ? STATE_ARMED_IDLE : STATE_DISARMED_IDLE;
    }
    return;
  }
  if (currentState == STATE_BOOTING) {
    if (mqttClient.connected()) {
      currentState = armed ? STATE_ARMED_IDLE : STATE_DISARMED_IDLE;
    }
    return;
  }
  // Keep idle state in sync with armed/disarmed transitions
  currentState = armed ? STATE_ARMED_IDLE : STATE_DISARMED_IDLE;
}

// ==========================================================
// MATRIX DISPLAY (the system's "face" — HCI layer)
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
    case STATE_BOOTING:      drawBootingSpinner(); break;
    case STATE_DISARMED_IDLE:drawSunGlyph();        break;
    case STATE_ARMED_IDLE:   drawBreathingMoon();   break;
    case STATE_DOOR_MOVING:  drawDoorArrows();      break;
    case STATE_ALERT:        drawAlertEyes();       break;
  }

  if (buttonAckActive) {
    drawButtonAckOverlay();
  }

  matrix.show();
}

// Perimeter coordinates in order, for the spinner animation
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
  matrix.setBrightness(25); // dim, unobtrusive daytime indicator
  uint32_t dimYellow = matrix.Color(60, 50, 0);
  setPixelXY(3,3, dimYellow); setPixelXY(3,4, dimYellow);
  setPixelXY(4,3, dimYellow); setPixelXY(4,4, dimYellow);
  setPixelXY(1,3, dimYellow); setPixelXY(1,4, dimYellow); // top ray
  setPixelXY(6,3, dimYellow); setPixelXY(6,4, dimYellow); // bottom ray
  setPixelXY(3,1, dimYellow); setPixelXY(4,1, dimYellow); // left ray
  setPixelXY(3,6, dimYellow); setPixelXY(4,6, dimYellow); // right ray
}

void drawBreathingMoon() {
  // Slow triangle-wave "breathing" brightness so it reads as calm, alive, not alarming
  float phase = (millis() % 3000) / 3000.0;
  int brightness = 8 + (int)(22 * (phase < 0.5 ? phase * 2 : (1 - phase) * 2));
  matrix.setBrightness(brightness);

  uint32_t blue = matrix.Color(20, 40, 255);
  int crescent[][2] = {{2,4},{2,5},{3,3},{3,6},{4,3},{4,6},{5,3},{5,6},{6,4},{6,5}};
  for (auto &p : crescent) setPixelXY(p[0], p[1], blue);
}

void drawDoorArrows() {
  matrix.setBrightness(50);
  uint32_t yellow = matrix.Color(255, 140, 0);
  bool on = (millis() / 200) % 2 == 0;
  if (!on) return; // blink off phase
  int arrowUp[][2]   = {{1,3},{1,4},{2,2},{2,5},{3,1},{3,6}};
  for (auto &p : arrowUp) setPixelXY(p[0], p[1], yellow);
  int arrowDown[][2] = {{6,3},{6,4},{5,2},{5,5},{4,1},{4,6}};
  for (auto &p : arrowDown) setPixelXY(p[0], p[1], yellow);
}

void drawAlertEyes() {
  matrix.setBrightness(255); // maximum visibility — this is the actual deterrent
  unsigned long elapsed = millis() - deterrentStartTime;
  bool on = (elapsed / 150) % 2 == 0; // fast strobe
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
