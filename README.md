# Smart Coop Predator Deterrent — ESP32 Edition

A WiFi-connected predator deterrent system for chicken coops. It watches for motion
after dark, fires lights + sound + a strobing "eyes" pattern to scare off predators,
auto-locks the coop door at night, and reports/accepts commands from a companion app
over MQTT.

---

## 1. Project Files

| File | Purpose |
|---|---|
| `diagram.json` | Wokwi circuit diagram (ESP32 + all sensors/actuators wired) |
| `sketch.ino` (`smart_coop_deterrent.ino`) | Main firmware |
| `libraries.txt` | Tells Wokwi which libraries to auto-install |
| `README.md` | This file |

All four files must sit in the **same project folder** (whether that's a Wokwi project
or a local Arduino sketch folder).

---

## 2. Hardware / Bill of Materials

- ESP32 DevKit V1 (the "brain" — replaces any Arduino Uno; Uno has no WiFi so it's not used in this project)
- PIR motion sensor
- LDR (photoresistor) light sensor
- 8x8 WS2812 NeoPixel matrix
- Piezo buzzer
- 2x LED (1 red = deterrent indicator, 1 green = WiFi status) + 2x 220Ω resistors
- SG90 (or similar) servo — coop door lock/latch
- Pushbutton (manual trigger/test)

## 3. Pinout (ESP32 DevKit V1)

| Component | Pin | Notes |
|---|---|---|
| PIR OUT | GPIO 27 | digital input |
| Pushbutton | GPIO 26 | `INPUT_PULLUP`, other leg to GND |
| LDR AO | GPIO 34 | ADC1-only input, analog read (0–4095) |
| NeoPixel Matrix DIN | GPIO 5 | WS2812, driven via Adafruit_NeoPixel |
| Deterrent LED (red) | GPIO 25 | through 220Ω resistor |
| WiFi status LED (green) | GPIO 2 | through 220Ω resistor |
| Buzzer | GPIO 33 | driven with `tone()`/`noTone()` |
| Servo (door lock) | GPIO 32 | PWM via ESP32Servo |

Power: PIR and matrix run off ESP32's `5V` pin; LDR and other 3.3V-tolerant parts off `3V3`. Multiple `GND` pins are used (`GND.1`, `GND.2`, `GND.3`) — all commons, just spread across the board's ground pins in the diagram.

---

## 4. Running the Simulation in Wokwi

1. Create a new Wokwi ESP32 project (or open this one if shared as a project link).
2. Make sure `diagram.json`, `sketch.ino`, and `libraries.txt` are all present.
3. Press the green "Play" (▶) button to build and run.
4. Wokwi reads `libraries.txt` and auto-installs `PubSubClient`, `Adafruit NeoPixel`, and `ESP32Servo` before compiling — no manual steps needed in the simulator.
5. Wokwi's simulated WiFi has real internet access, so MQTT will actually connect if your broker is reachable from the internet (see Section 6).

**If you get `fatal error: <Library>.h: No such file or directory`:** it means `libraries.txt` is missing, misspelled, or not in the same folder — double check it contains exactly:
```
PubSubClient
Adafruit NeoPixel
ESP32Servo
```

## 5. Running on Real ESP32 Hardware (Arduino IDE)

1. Install the ESP32 board package: **Tools → Board → Boards Manager** → search `esp32` → install "esp32 by Espressif Systems".
2. Select your board: **Tools → Board → ESP32 Arduino → ESP32 Dev Module** (or your specific board).
3. Install libraries via **Sketch → Include Library → Manage Libraries**:
   - `PubSubClient` (Nick O'Leary)
   - `Adafruit NeoPixel` (Adafruit)
   - `ESP32Servo` (Kevin Harrington / John K. Bennett)
4. Wire the hardware exactly per the pinout table in Section 3.
5. Edit the config block at the top of the sketch (Section 6 below) with your real WiFi and MQTT details.
6. Select the correct COM port under **Tools → Port**, then Upload.
7. Open **Tools → Serial Monitor** at `115200` baud to watch connection/status logs.

---

## 6. Configuration

At the top of `sketch.ino`, edit these before building:

```cpp
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

const char* MQTT_BROKER   = "YOUR_BROKER_IP_OR_DOMAIN";
const int   MQTT_PORT     = 1883;
const char* MQTT_CLIENT_ID= "smart_coop_esp32";
const char* MQTT_USER     = "coop_device";
const char* MQTT_PASS     = "YOUR_STRONG_PASSWORD";
```

Also worth tuning once you test with the real LDR in your environment:

```cpp
#define LDR_DARK_THRESHOLD 1500   // lower = only triggers "dark" mode in near-total darkness
```

Raise or lower this depending on how bright your coop's surroundings are at dusk — watch the `coop/status/light` MQTT value (or Serial Monitor) at different times of day and set the threshold roughly halfway between your daytime and nighttime readings.

---

## 7. Setting Up Your Own MQTT Broker (Mosquitto)

The firmware is built for a **private, authenticated broker** (not a public test broker) — appropriate since this system controls a physical door lock.

On a Raspberry Pi, home server, or small cloud VM (DigitalOcean, Lightsail, etc.):

```bash
sudo apt update
sudo apt install mosquitto mosquitto-clients -y

# Create a device login
sudo mosquitto_passwd -c /etc/mosquitto/passwd coop_device
# (enter a strong password — use this same password in MQTT_PASS in the sketch)
```

Edit `/etc/mosquitto/conf.d/default.conf`:
```
listener 1883
allow_anonymous false
password_file /etc/mosquitto/passwd
```

Restart and enable on boot:
```bash
sudo systemctl restart mosquitto
sudo systemctl enable mosquitto
```

**Networking notes:**
- Same home WiFi as the ESP32 → use the machine's local IP for `MQTT_BROKER`.
- Want app control from outside the house → put the broker on a cloud VM with a static IP or dynamic DNS name, and open port 1883 (or 8883 for TLS) in the firewall.
- **Security upgrade for later:** add TLS on port 8883 (`WiFiClientSecure` in the sketch) once basic auth is confirmed working — recommended before this ever guards a real coop unattended.

Quick test that your broker works, from your computer:
```bash
mosquitto_sub -h YOUR_BROKER_IP -u coop_device -P yourpassword -t "coop/#" -v
```
You should see status messages appear once the ESP32 boots and connects.

---

## 8. MQTT Topic Reference (for the App/Software Team)

### Published by the device (device → app)

| Topic | Payload | Meaning |
|---|---|---|
| `coop/status/pir` | `"0"` / `"1"` | current motion sensor state |
| `coop/status/light` | integer `0–4095` | raw LDR reading |
| `coop/status/armed` | `"0"` / `"1"` | is the deterrent system armed (dark/night or app-forced) |
| `coop/status/door` | `"open"` / `"closed"` | current door position |
| `coop/alert/predator` | `"1"` | fired once per deterrent trigger event (motion detected while armed) |
| `coop/status/online` | `"1"` (retained); `"0"` on unexpected disconnect (LWT) | device connectivity status — use this to show "online/offline" in the app |

Status topics are published every ~5 seconds, plus immediately on state changes (door open/close, alerts).

### Subscribed by the device (app → device)

| Topic | Payload | Effect |
|---|---|---|
| `coop/cmd/door` | `"open"` / `"close"` | manually open or close/lock the coop door |
| `coop/cmd/deterrent` | `"trigger"` | force-fire the lights/buzzer/matrix immediately, regardless of armed state |
| `coop/cmd/arm` | `"auto"` / `"on"` / `"off"` | `auto` = system decides based on darkness (default); `on`/`off` = app overrides arming manually |

The app should subscribe to `coop/status/#` and `coop/alert/#` for a live dashboard, and publish to the `coop/cmd/*` topics to control the device.

---

## 9. Behavior Logic Summary

1. **Day/night detection:** LDR reading below `LDR_DARK_THRESHOLD` = "dark" → system auto-arms and closes the door.
2. **Motion while armed:** PIR trigger → deterrent fires: red LED on, buzzer tone, strobing "eyes" pattern on the matrix, for `DETERRENT_DURATION_MS` (default 5 seconds). A `coop/alert/predator` message is published once per trigger, with a cooldown (`TRIGGER_COOLDOWN_MS`, default 3s) so it doesn't spam re-triggers from the same event.
3. **Manual button press:** always fires the deterrent regardless of armed state (useful for testing).
4. **App override:** `coop/cmd/arm` can force arming on/off regardless of light level; `coop/cmd/door` and `coop/cmd/deterrent` give direct manual control any time.

---

## 10. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `fatal error: PubSubClient.h: No such file or directory` | Missing `libraries.txt` (Wokwi) or libraries not installed (Arduino IDE) — see Section 4/5. |
| ESP32 won't connect to WiFi | Check `WIFI_SSID`/`WIFI_PASSWORD` spelling; ESP32 only supports 2.4GHz networks, not 5GHz. |
| MQTT won't connect, `rc=` error printed in Serial Monitor | Check broker IP/port reachability, and that `MQTT_USER`/`MQTT_PASS` match what you created with `mosquitto_passwd`. Common `rc` codes: `-2` = network unreachable, `5` = not authorized (bad credentials). |
| Door never closes at night | `LDR_DARK_THRESHOLD` may be miscalibrated for your environment — check `coop/status/light` values at night vs. day and adjust. |
| Deterrent never fires | Confirm `armed` is true (check `coop/status/armed`), and that the PIR sensor's sensitivity/delay potentiometers (on real hardware) aren't set too low/long. |
| App shows device "offline" even though it's running | Broker LWT (`coop/status/online`) only flips to `1` after a successful MQTT connect — check WiFi/MQTT connection logs in Serial Monitor. |

---

## 11. Possible Future Improvements

- TLS-encrypted MQTT (port 8883) for production security.
- OTA (over-the-air) firmware updates so you don't need a USB cable for future changes.
- Battery + solar power monitoring if the coop isn't near a wall outlet.
- Additional predator-specific deterrent patterns (different matrix animations, varied buzzer tones) if certain animals prove more persistent.
- Local SD card logging of trigger events as a backup to MQTT.
