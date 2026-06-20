# MDS221-2026-art-2

Generative p5.js sketch inspired by a geometric, painterly color-block aesthetic.

## Run locally

Copy/paste these commands in Terminal:

```bash
cd "/Users/tanruilin/Desktop/new/MDS221-2026-art-2/digital"
python3 -m http.server 8080
```

Then open this URL in your browser:

```text
http://localhost:8080
```

## Controls

- Press `S` to add a square block layer to a random tower.
- Press `R` to add a random-width horizontal rectangle layer.
- Press `P` to save the current image as a PNG.

## Tangible / ESP32

Weight-sensing firmware lives in `tangible/esp32_weight_websocket/`. An **ESP32-C3 Super Mini** reads an HX711 load cell, distinguishes blocks by memorized weight, and pushes events over WebSocket.

### Board settings (Arduino IDE)

| Setting | Value |
|---------|-------|
| Board | **ESP32C3 Dev Module** |
| USB CDC On Boot | **Enabled** |
| Flash Size | 4MB (default on Super Mini) |

Install the **HX711** and **WebSockets** (Links2004) libraries, plus the ESP32 board package (2.x+).

### Wiring (ESP32-C3 Super Mini)

| HX711 / signal | ESP32-C3 pin | Notes |
|----------------|--------------|-------|
| DT (data) | GPIO4 | Load cell data |
| SCK (clock) | GPIO3 | Load cell clock |
| VCC | 3V3 | |
| GND | GND | |
| Status LED | GPIO8 | Onboard blue LED (active low; no extra wiring) |

Avoid GPIO20/21 (hardware UART) and GPIO9 (BOOT button). Native USB uses GPIO18/19 internally.

### Flash and configure

1. Copy `tangible/esp32_weight_websocket/secrets.example.h` to `secrets.h` in the same folder.
2. Fill in WiFi credentials, `REGISTER_BASE_URL`, `REGISTER_SECRET`, and `DEVICE_CODE_ID` (`MDS221-2026-2`).
3. Flash `tangible/esp32_weight_websocket/esp32_weight_websocket.ino`.
4. Open Serial Monitor at **115200** baud. Tare with an empty scale: send `do_tare`.
5. Place each block type and memorize its weight: `set_mem_1` … `set_mem_9`.

On boot the ESP32 connects to WiFi, registers with the cloud registry, and serves WebSocket on port **81** at `ws://<device-ip>:81/`.

### WebSocket messages (ESP32 → client)

Plain-text lines broadcast when item state changes:

```text
notify_item_1
notify_item_on
notify_item_off
notify_weight: 42.50
```

`notify_item_N` is sent when a placed item matches memorized slot `N`. `notify_item_on` is sent for an unrecognized item. `notify_item_off` when the scale goes empty.

### Serial commands (calibration)

| Command | Purpose |
|---------|---------|
| `do_tare` | Zero the scale (empty platform) |
| `set_mem_1` … `set_mem_9` | Memorize current weight for slot N |
| `unset_mem_1` … `unset_mem_9` | Clear slot N |
| `get_mem_1` … `get_mem_9` | Read slot N |
| `list_mems` | List all slots |
| `clear_mems` | Clear all slots |
| `set_mem_tolerance 4.0` | Weight match tolerance (grams) |
| `help` | List commands |

### Connect the digital sketch (registry lookup)

Same pattern as [MDS221-2026-art-4](https://github.com/ktorn/MDS221-2026-art-4):

1. Copy `digital/secrets.example.js` to `digital/secrets.js` (same `registryToken` and `deviceId` as `secrets.h`).
2. On startup the page calls the cloud registry `/lookup` endpoint and connects to `ws://<lan_ip>:81`.
3. Place a memorized block on the scale — each `notify_item_1` adds a **square** layer, each `notify_item_2` adds a **horizontal rectangle**. Lifting the block (`notify_item_off`) does not remove layers; reuse the same two blocks to keep stacking.

Overrides:

- URL params: `?deviceId=MDS221-2026-2&token=...`
- Direct LAN IP: `?wsHost=192.168.1.50` or `?ws=ws://192.168.1.50:81`
