# Smart Coop Predator Deterrent — ESP32 Edition

A self-contained, WiFi-connected predator deterrent for chicken coops. The ESP32 runs a local HTTP + WebSocket API — **no backend, no MQTT broker, no cloud**. A companion mobile app connects directly to the device over your home WiFi.

The system arms automatically at night, watches for motion with radar + PIR, escalates through CLEAR → CAUTION → DANGER → ALERT, and fires a two-tone siren + red strobe + 8×8 matrix display. Everything is visible on the device itself; the app is for remote monitoring and control.

---

## 1. Project Files

| File | Purpose |
|---|---|
| `diagram.json` | Wokwi circuit diagram (ESP32 + all sensors/actuators wired) |
| `smart_coop_deterrent.ino` | Main firmware |
| `libraries.txt` | Wokwi library auto-install list |
| `scpd-mobile/App.js` | React Native / Expo companion app |
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
---

## 2. Hardware / Bill of Materials

- ESP32 DevKit V1
- RCWL-0516 microwave radar sensor
- HC-SR501 (or similar) PIR motion sensor
- LDR module with digital `DO` output (LM393-style)
- 8×8 LED matrix — **MAX7219 / 1088AS** (DIN → GPIO 5, CS → GPIO 17, CLK → GPIO 18)
- Passive buzzer → GPIO 26
- Red alert LED (through 220 Ω) → GPIO 25
- WiFi status LED → GPIO 2
- Pushbutton (manual trigger) → GPIO 32
- 5 V regulated supply for the matrix (≥ 4 A recommended); common GND with ESP32

> **Note:** The matrix is driven with a small built-in MAX7219 `shiftOut` driver — no extra NeoPixel/Adafruit_NeoPixel library needed. A 74AHCT125 level shifter on the matrix data line is recommended for reliable real-world operation.

---

## 3. Pinout (ESP32 DevKit V1)

| Component | Pin | Notes |
|---|---|---|
| RCWL-0516 OUT | GPIO 4 | 3.3 V-tolerant radar output |
| PIR OUT | GPIO 27 | digital input |
| Pushbutton | GPIO 32 | `INPUT_PULLUP`, other leg to GND |
| LDR DO | GPIO 34 | digital input; adjust the module trimmer for your dark threshold |
| Matrix DIN | GPIO 5 | MAX7219 data |
| Matrix CS | GPIO 17 | MAX7219 chip-select |
| Matrix CLK | GPIO 18 | MAX7219 clock |
| Buzzer | GPIO 26 | passive buzzer + GND |
| Red alert LED | GPIO 25 | through 220 Ω |
| WiFi status LED | GPIO 2 | through 220 Ω |
| Battery voltage sense | GPIO 35 | optional analog input |

---

## 4. Firmware Behavior

### 4.1 Arming
The system is **armed at night** (LDR = dark). The mobile app can also force `auto` / `on` / `off`.

### 4.2 Threat Levels

| Level | Trigger | Matrix | Red LED | Buzzer |
|---|---|---|---|---|
| **CLEAR** | No motion | Green breathing moon | OFF | OFF |
| **CAUTION** | Radar only, sustained ≥ 2 s | Yellow border + inner pulse | Solid | OFF |
| **DANGER** | PIR + radar simultaneous | Orange frame + flashing crosshair | Solid | OFF |
| **ALERT** | Deterrent actively firing | Red blinking alarm (~2 Hz) | Fast strobe | Two-tone 2.5 kHz / 1.2 kHz |
| **BOOTING** | WiFi not yet connected | Blue rotating spinner | OFF | OFF |
| **OFFLINE** | WiFi lost after connect | Normal threat glyph + blinking blue corner pixel | — | — |

- Matrix brightness auto-adjusts to ambient light (LDR): dim in darkness, bright in daylight, full during ALERT.
- Button press: manual trigger + white flash acknowledgement on matrix.
- Component toggles (radar, PIR, deterrent, matrix, buzzer) are available from the app and respected by the firmware immediately.

### 4.3 Radar hold
A detection is held for **4 seconds** (`RADAR_HOLD_MS`) after the last radar HIGH so the CAUTION state and the app’s radar dot stay visible instead of flickering off.

---

## 5. Mobile App Connection (No Backend)

The app (`scpd-mobile/App.js`) is a React Native / Expo app. It discovers and talks to the ESP32 **directly** — no cloud, no broker.

### 5.1 Discovery
1. Tries mDNS: `coop-plus.local`, `smart-coop.local` (best on iOS; Android may require manual IP).
2. Scans a few common static IPs.
3. Scans the **phone’s actual WiFi subnet** (requires `expo-network`).
4. If discovery fails, enter the ESP32’s IP manually (shown in Serial Monitor at 115200 baud).

### 5.2 Live Communication
- **HTTP REST:** `GET /api/status`, `POST /api/commands/deterrent`, `POST /api/commands/arm`, `POST /api/commands/toggle_component`, `DELETE /api/events`, `DELETE /api/events/<id>`
- **WebSocket:** `ws://<host>:80/ws` pushes live status updates.

Both run on **port 80**. The phone and ESP32 must be on the **same LAN**.

---

## 6. Quick Start

### Wokwi (simulation)
1. Open the project in Wokwi.
2. Ensure `diagram.json`, `smart_coop_deterrent.ino`, and `libraries.txt` are present.
3. Press Play. Wokwi auto-installs the listed libraries.

### Real hardware (Arduino IDE / CLI)
1. Install the ESP32 board package (Espressif Systems).
2. Select **ESP32 Dev Module** (or your board).
3. Place `smart_coop_deterrent.ino` in a folder named `smart_coop_deterrent`.
4. Edit the WiFi block at the top of the sketch with your SSID and password.
5. Upload; open Serial Monitor at **115200 baud** to watch the connection logs and the printed local IP.

### Mobile app
```bash
cd scpd-mobile
npx expo install expo-network   # required for subnet-aware discovery
npx expo start
```
Scan the QR with Expo Go (or run on a simulator). Tap **Connect**; if auto-detect misses, type the ESP32’s IP manually.

---

## 7. Serial Test Commands

With the ESP32 connected to Serial Monitor (`115200` baud, `NL + CR` or line ending set appropriately):

| Command | Effect |
|---|---|
| `help` | Print this menu |
| `status` | Full system status report |
| `led` | Blink the red alert LED 3× |
| `buzzer` | 2-second buzzer test |
| `matrix` | Cycle through all matrix states |
| `telemetry` | Live sensor stream |
| `ldr_calib` | Calibrate LDR dark threshold |

---

## 8. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| App can’t discover the device | Phone and ESP32 are on different subnets, or AP/client isolation is on. Enter the ESP32’s IP manually (shown in Serial Monitor). |
| App connects but “Connecting…” flickers / kicks back to Home | Auto-reconnect now runs silently in the background; reload the app. If it persists, the firmware’s WiFi is flapping — check signal strength. |
| Matrix is blank / wrong size | Confirm DIN/CS/CLK wiring and that the matrix is powered from a separate 5 V supply, not the ESP32’s USB pin. |
| Buzzer quiet or clicking | Passive buzzer on GPIO 26 + GND. If using an active buzzer, the pitch sweep won’t work — swap to passive. |
| Deterrent never fires | Check `armed` state (Serial `status`), LDR dark threshold, and that radar/PIR toggles are enabled in the app. |
| Events/activities not clearing | Use the trash icon on individual events, or the **Clear** button in History. Both now hit firmware endpoints and refresh automatically. |

---

## 9. Design Notes (for the poster / reviewers)

- **No cloud dependency.** The ESP32 hosts its own API; the phone talks to it directly. If the internet goes down, the coop still works locally.
- **Sensors are toggleable.** Radar, PIR, deterrent, matrix, and buzzer can all be switched off from the app — useful for testing or quiet hours.
- **8×8 matrix is the primary local HCI.** Color code: green = safe, yellow = caution, orange = danger, red = alert, blue = booting/offline. The red LED stays solid for any active threat and strobes only while the siren fires.
- **Radar hold = 4 s.** A single detection lingers on the display and in the app long enough to be useful, instead of vanishing after one sensor pulse.

---

## 10. Possible Future Improvements

- TLS-encrypted API (`WiFiServerSecure`) for production.
- OTA firmware updates.
- Battery + solar monitoring if the coop isn’t near a wall outlet.
- Per-animal deterrent patterns if certain predators prove more persistent.
- Local SD-card event logging as a backup to the app.
