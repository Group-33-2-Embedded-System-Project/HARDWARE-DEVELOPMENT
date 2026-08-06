# Smart Coop Predator Deterrent — ESP32 Edition

A WiFi-connected predator deterrent system for chicken coops. It watches for motion
after dark, fires lights + sound + a strobing "eyes" pattern to scare off predators,
and reports/accepts commands from a companion app over MQTT. The current hardware
version has no door-lock servo.

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

### Revised 3D enclosure

The original root-level STL exports are legacy files and are substantially oversized.
The editable compact replacement is in [`enclosure/`](enclosure/):
`smart_coop_enclosure.scad` generates a 104 × 78 × 30 mm base and a matching fitted
lid. The design uses 1.8 mm walls, a 1.6 mm floor/lid, M2.5 screw bosses, a
MAX7219 display aperture, a cable exit, and print-friendly ventilation. Component
envelopes, tolerances, and export instructions are in `enclosure/DIMENSIONS.md`.

---

## 2. Hardware / Bill of Materials

- ESP32 DevKit V1 (the "brain" — replaces any Arduino Uno; Uno has no WiFi so it's not used in this project)
- PIR motion sensor
- LDR module with a digital `DO` output (LM393-style comparator module)
- 8x8 WS2812 NeoPixel matrix
- Piezo buzzer
- 2x LED (1 red = deterrent indicator, 1 green = WiFi status) + 2x 220Ω resistors
- Pushbutton (manual trigger/test)

## 3. Pinout (ESP32 DevKit V1)

| Component | Pin | Notes |
|---|---|---|
| PIR OUT | GPIO 27 | digital input |
| Pushbutton | GPIO 26 | `INPUT_PULLUP`, other leg to GND |
| LDR DO | GPIO 34 | digital input; use the module trimmer to set the night threshold |
| NeoPixel Matrix DIN | GPIO 5 | WS2812, driven via Adafruit_NeoPixel |
| Deterrent LED (red) | GPIO 25 | through 220Ω resistor |
| WiFi status LED (green) | GPIO 2 | through 220Ω resistor |
| Buzzer | GPIO 33 | driven with `tone()`/`noTone()` |

Power in Wokwi is shown from the ESP32 pins. **For the physical build, do not power
the 8x8 matrix from the ESP32's 5V/USB pin.** Use a regulated 5V supply rated for at
least 4A, connect that supply directly to matrix `VDD` and `GND`, and connect its GND
to ESP32 GND (a common ground is required). Keep the 330Ω data resistor; add a
1000µF electrolytic capacitor across matrix 5V/GND near the matrix. A 74AHCT125 or
74HCT125 3.3V-to-5V level shifter on the matrix data wire is strongly recommended
for reliable real-world WS2812 operation.

The diagram uses the common HC-SR501 arrangement: PIR powered from 5V, with its 3.3V
`OUT` signal connected directly to GPIO27. Before wiring a different physical PIR,
check its datasheet. If its `OUT` signal is genuinely 5V, use a proper 3.3V logic-level
shifter; ESP32 GPIO pins are not 5V tolerant. Multiple `GND` pins (`GND.1`, `GND.2`,
`GND.3`) are all common ground points.

---

## 4. Running the Simulation in Wokwi

1. Create a new Wokwi ESP32 project (or open this one if shared as a project link).
2. Make sure `diagram.json`, `sketch.ino`, and `libraries.txt` are all present.
3. Press the green "Play" (▶) button to build and run.
4. Wokwi reads `libraries.txt` and auto-installs `PubSubClient` and `Adafruit NeoPixel` before compiling — no manual steps needed in the simulator.
5. Wokwi's simulated WiFi has real internet access, so MQTT will actually connect if your broker is reachable from the internet (see Section 6).

**If you get `fatal error: <Library>.h: No such file or directory`:** it means `libraries.txt` is missing, misspelled, or not in the same folder — double check it contains exactly:
```
PubSubClient
Adafruit NeoPixel
```

## 5. Running on Real ESP32 Hardware (Arduino IDE)

1. Install the ESP32 board package: **Tools → Board → Boards Manager** → search `esp32` → install "esp32 by Espressif Systems".
2. Select your board: **Tools → Board → ESP32 Arduino → ESP32 Dev Module** (or your specific board).
3. Install libraries via **Sketch → Include Library → Manage Libraries**:
   - `PubSubClient` (Nick O'Leary)
   - `Adafruit NeoPixel` (Adafruit)
4. For Arduino IDE, put `smart_coop_deterrent.ino` in a folder named
   `smart_coop_deterrent` before opening it. Arduino sketches require the main `.ino`
   file and its folder to have the same name.
5. Wire the hardware exactly per the pinout table in Section 3.
6. Edit the config block at the top of the sketch (Section 6 below) with your real WiFi and MQTT details.
7. Select the correct COM port under **Tools → Port**, then Upload.
8. Open **Tools → Serial Monitor** at `115200` baud to watch connection/status logs.

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

For the LDR module, set the small onboard trimmer to choose its dark/light switching
point. Then run the sketch's `status` serial command while covering and uncovering
the sensor. Set `LDR_DARK_WHEN_HIGH` in the sketch to match the result. Wokwi's LDR
module outputs HIGH in darkness by default.

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
| `coop/status/light` | `"0"` / `"1"` | interpreted light state: `"1"` = dark |
| `coop/status/armed` | `"0"` / `"1"` | is the deterrent system armed (dark/night or app-forced) |
| `coop/alert/predator` | `"1"` | fired once per deterrent trigger event (motion detected while armed) |
| `coop/status/online` | `"1"` (retained); `"0"` on unexpected disconnect (LWT) | device connectivity status — use this to show "online/offline" in the app |

Status topics are published every ~5 seconds.

### Subscribed by the device (app → device)

| Topic | Payload | Effect |
|---|---|---|
| `coop/cmd/deterrent` | `"trigger"` | force-fire the lights/buzzer/matrix immediately, regardless of armed state |
| `coop/cmd/arm` | `"auto"` / `"on"` / `"off"` | `auto` = system decides based on darkness (default); `on`/`off` = app overrides arming manually |

The app should subscribe to `coop/status/#` and `coop/alert/#` for a live dashboard, and publish to the `coop/cmd/*` topics to control the device.

---

## 9. Behavior Logic Summary

1. **Day/night detection:** the LDR module's `DO` pin indicates darkness → system auto-arms.
2. **Motion while armed:** PIR trigger → deterrent fires: red LED on, buzzer tone, fast strobing "eyes" on the matrix, for `DETERRENT_DURATION_MS` (default 5 seconds). A `coop/alert/predator` message is published once per trigger, with a cooldown (`TRIGGER_COOLDOWN_MS`, default 3s) so it doesn't spam re-triggers from the same event.
3. **Manual button press:** debounced and edge-triggered (won't repeat-fire if held down) — always fires the deterrent regardless of armed state (useful for testing), plus gives a brief white-flash acknowledgement on the matrix so you know the press registered.
4. **App override:** `coop/cmd/arm` can force arming on/off regardless of light level; `coop/cmd/deterrent` gives a direct manual test trigger any time.

## 9b. Matrix Display States (System "Face")

The 8x8 matrix acts as an at-a-glance status display, so someone checking on the coop doesn't need the app open. It runs as a non-blocking state machine — animations never stall sensor reads or MQTT:

| State | Visual | Meaning |
|---|---|---|
| Booting | Slow blue dot circling the border | WiFi/MQTT still connecting |
| Disarmed idle | Dim static "sun" glyph | Daytime, watching but not armed |
| Armed idle | Soft "breathing" blue moon (slow brightness pulse) | Nighttime, actively protecting, calm state |
| Alert | Fast strobing red "eyes", full brightness | Predator detected — this is the actual deterrent effect |
| (any state) | Brief full white flash overlay | Confirms a manual button press was registered |

The WiFi status LED also communicates connection stages: slow blink = no WiFi, fast blink = WiFi connected but MQTT still connecting, solid = fully connected.

---

## 10. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `fatal error: PubSubClient.h: No such file or directory` | Missing `libraries.txt` (Wokwi) or libraries not installed (Arduino IDE) — see Section 4/5. |
| ESP32 won't connect to WiFi | Check `WIFI_SSID`/`WIFI_PASSWORD` spelling; ESP32 only supports 2.4GHz networks, not 5GHz. |
| MQTT won't connect, `rc=` error printed in Serial Monitor | Check broker IP/port reachability, and that `MQTT_USER`/`MQTT_PASS` match what you created with `mosquitto_passwd`. Common `rc` codes: `-2` = network unreachable, `5` = not authorized (bad credentials). |
| System arms in bright light or stays disarmed in darkness | `LDR_DARK_WHEN_HIGH` is backwards, or the module trimmer threshold needs adjustment. Use the `status` serial command while covering/uncovering the sensor. |
| Deterrent never fires | Confirm `armed` is true (check `coop/status/armed`), and that the PIR sensor's sensitivity/delay potentiometers (on real hardware) aren't set too low/long. |
| App shows device "offline" even though it's running | Broker LWT (`coop/status/online`) only flips to `1` after a successful MQTT connect — check WiFi/MQTT connection logs in Serial Monitor. |

---

## 11. Possible Future Improvements

- TLS-encrypted MQTT (port 8883) for production security.
- OTA (over-the-air) firmware updates so you don't need a USB cable for future changes.
- Battery + solar power monitoring if the coop isn't near a wall outlet.
- Additional predator-specific deterrent patterns (different matrix animations, varied buzzer tones) if certain animals prove more persistent.
- Local SD card logging of trigger events as a backup to MQTT.
