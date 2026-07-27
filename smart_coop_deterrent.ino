/*
  ==========================================================
   SMART COOP PREDATOR DETERRENT — ESP32 Firmware
  ==========================================================
  Hardware:
    - PIR motion sensor      -> GPIO 27
    - Pushbutton (manual)    -> GPIO 26 (INPUT_PULLUP)
    - LDR (light sensor)     -> GPIO 34 (ADC1, analog)
    - WS2812 8x8 matrix      -> GPIO 5
    - Buzzer                 -> GPIO 33
    - Deterrent LED (red)    -> GPIO 25
    - WiFi status LED (grn)  -> GPIO 2
    - Servo (coop door lock) -> GPIO 32

  Connectivity:
    - WiFi + MQTT for app communication (PubSubClient)

  Libraries needed (install via Library Manager):
    - PubSubClient      by Nick O'Leary
    - Adafruit NeoPixel by Adafruit
    - ESP32Servo        by Kevin Harrington / John K. Bennett

  MQTT Topic Map (for the app/software team)
  --------------------------------------------------------
  PUBLISH (device -> app):
    coop/status/pir        "0" | "1"            motion state
    coop/status/light      raw int 0-4095       LDR reading
    coop/status/armed      "0" | "1"            armed (dark) or not
    coop/status/door       "open" | "closed"    door position
    coop/alert/predator    "1"                  fired once per trigger event
    coop/status/online     "1" (retained, LWT "0")

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

const char* MQTT_BROKER   = "YOUR_BROKER_IP_OR_DOMAIN";  // your Mosquitto server's IP or hostname
const int   MQTT_PORT     = 1883;                        // 8883 if you enable TLS on the broker
const char* MQTT_CLIENT_ID= "smart_coop_esp32";
const char* MQTT_USER     = "coop_device";               // must match a user created on your broker
const char* MQTT_PASS     = "YOUR_STRONG_PASSWORD";      // never leave this blank on a self-hosted broker

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

// LDR threshold: below this = "dark" (tune after testing your sensor/environment)
#define LDR_DARK_THRESHOLD 1500

// Door servo angles
#define SERVO_OPEN_ANGLE   90
#define SERVO_CLOSED_ANGLE 0

// Deterrent duration (ms) once triggered
#define DETERRENT_DURATION_MS 5000
// Minimum time between separate deterrent triggers (debounce)
#define TRIGGER_COOLDOWN_MS 3000
// How often to publish routine sensor status
#define STATUS_PUBLISH_INTERVAL_MS 5000

// ---------------- GLOBAL OBJECTS ----------------
WiFiClient espClient;
PubSubClient mqttClient(espClient);
Adafruit_NeoPixel matrix(NUM_PIXELS, PIN_MATRIX, NEO_GRB + NEO_KHZ800);
Servo doorServo;

// ---------------- STATE ----------------
bool armed = true;              // auto-armed when dark, unless overridden
bool armOverride = false;       // true if app forced arm on/off
bool armOverrideValue = false;
bool doorOpen = true;
bool deterrentActive = false;
unsigned long deterrentStartTime = 0;
unsigned long lastTriggerTime = 0;
unsigned long lastStatusPublish = 0;
int lastPirState = LOW;

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
  matrix.setBrightness(80);
  matrix.clear();
  matrix.show();

  doorServo.attach(PIN_SERVO);
  openDoor(); // start with door open by default

  connectWiFi();
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);

  Serial.println("Smart Coop Predator Deterrent ready.");
}

// ==========================================================
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    digitalWrite(PIN_LED_WIFI, LOW);
    connectWiFi();
  } else {
    digitalWrite(PIN_LED_WIFI, HIGH);
  }

  if (!mqttClient.connected()) {
    connectMQTT();
  }
  mqttClient.loop();

  int lightLevel = analogRead(PIN_LDR);
  bool isDark = (lightLevel < LDR_DARK_THRESHOLD);

  // Determine armed state: auto (based on darkness) unless app overrides it
  if (armOverride) {
    armed = armOverrideValue;
  } else {
    armed = isDark;
  }

  // Auto-close the door at dusk, auto-open at dawn (only if not manually overridden by app recently)
  if (isDark && doorOpen) {
    closeDoor();
  } else if (!isDark && !doorOpen) {
    openDoor();
  }

  int pirState = digitalRead(PIN_PIR);
  bool buttonPressed = (digitalRead(PIN_BUTTON) == LOW);

  if (armed && pirState == HIGH && lastPirState == LOW) {
    unsigned long now = millis();
    if (now - lastTriggerTime > TRIGGER_COOLDOWN_MS) {
      triggerDeterrent();
      lastTriggerTime = now;
      mqttClient.publish(TOPIC_ALERT, "1");
    }
  }
  lastPirState = pirState;

  if (buttonPressed) {
    triggerDeterrent(); // manual test/trigger, ignores arm state
  }

  updateDeterrent();

  // Periodic status publish for the app dashboard
  unsigned long now = millis();
  if (now - lastStatusPublish > STATUS_PUBLISH_INTERVAL_MS) {
    publishStatus(pirState, lightLevel);
    lastStatusPublish = now;
  }
}

// ==========================================================
// WIFI / MQTT
// ==========================================================
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
  Serial.print("Connecting to MQTT broker...");
  // Last Will: if device drops off unexpectedly, broker publishes "0" retained
  bool connected;
  if (strlen(MQTT_USER) > 0) {
    connected = mqttClient.connect(MQTT_CLIENT_ID, MQTT_USER, MQTT_PASS,
                                    TOPIC_ONLINE, 0, true, "0");
  } else {
    connected = mqttClient.connect(MQTT_CLIENT_ID,
                                    TOPIC_ONLINE, 0, true, "0");
  }
  if (connected) {
    Serial.println("connected.");
    mqttClient.publish(TOPIC_ONLINE, "1", true);
    mqttClient.subscribe(TOPIC_CMD_DOOR);
    mqttClient.subscribe(TOPIC_CMD_DETERRENT);
    mqttClient.subscribe(TOPIC_CMD_ARM);
  } else {
    Serial.print("failed, rc=");
    Serial.println(mqttClient.state());
    delay(2000);
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
    if (msg == "auto") {
      armOverride = false;
    } else if (msg == "on") {
      armOverride = true;
      armOverrideValue = true;
    } else if (msg == "off") {
      armOverride = true;
      armOverrideValue = false;
    }
  }
}

void publishStatus(int pirState, int lightLevel) {
  mqttClient.publish(TOPIC_PIR, pirState == HIGH ? "1" : "0");
  mqttClient.publish(TOPIC_LIGHT, String(lightLevel).c_str());
  mqttClient.publish(TOPIC_ARMED, armed ? "1" : "0");
  mqttClient.publish(TOPIC_DOOR, doorOpen ? "open" : "closed");
}

// ==========================================================
// DOOR CONTROL
// ==========================================================
void openDoor() {
  doorServo.write(SERVO_OPEN_ANGLE);
  doorOpen = true;
  mqttClient.publish(TOPIC_DOOR, "open");
  Serial.println("Door opened.");
}

void closeDoor() {
  doorServo.write(SERVO_CLOSED_ANGLE);
  doorOpen = false;
  mqttClient.publish(TOPIC_DOOR, "closed");
  Serial.println("Door closed.");
}

// ==========================================================
// DETERRENT (lights + sound)
// ==========================================================
void triggerDeterrent() {
  deterrentActive = true;
  deterrentStartTime = millis();
  digitalWrite(PIN_LED_RED, HIGH);
  tone(PIN_BUZZER, 2000); // continuous alarm tone while active
  showEyesPattern();
  Serial.println("Deterrent triggered!");
}

void updateDeterrent() {
  if (!deterrentActive) return;

  unsigned long elapsed = millis() - deterrentStartTime;

  // Simple strobe effect on the matrix while active
  if ((elapsed / 250) % 2 == 0) {
    showEyesPattern();
  } else {
    matrix.clear();
    matrix.show();
  }

  if (elapsed > DETERRENT_DURATION_MS) {
    deterrentActive = false;
    digitalWrite(PIN_LED_RED, LOW);
    noTone(PIN_BUZZER);
    matrix.clear();
    matrix.show();
    Serial.println("Deterrent cycle ended.");
  }
}

// Draws a simple pair of glowing "eyes" on the 8x8 matrix to startle predators
void showEyesPattern() {
  matrix.clear();
  uint32_t eyeColor = matrix.Color(255, 0, 0); // red
  setPixelXY(2, 2, eyeColor);
  setPixelXY(2, 5, eyeColor);
  setPixelXY(3, 2, eyeColor);
  setPixelXY(3, 5, eyeColor);
  matrix.show();
}

void setPixelXY(int row, int col, uint32_t color) {
  int index = row * MATRIX_COLS + col;
  if (index >= 0 && index < NUM_PIXELS) {
    matrix.setPixelColor(index, color);
  }
}
