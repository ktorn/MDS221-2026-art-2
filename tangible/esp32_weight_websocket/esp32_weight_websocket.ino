#include <Arduino.h>
#include <HX711.h>
#include <Preferences.h>
#include <math.h>
#include <WiFi.h>
#include <WebSocketsServer.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <cstring>
#include <esp_wifi.h>

#if __has_include("secrets.h")
#include "secrets.h"
#endif

#ifndef REGISTER_BASE_URL
#define REGISTER_BASE_URL ""
#endif
#ifndef REGISTER_SECRET
#define REGISTER_SECRET ""
#endif
#ifndef DEVICE_CODE_ID
#define DEVICE_CODE_ID ""
#endif
#ifndef WIFI_SSID
#define WIFI_SSID ""
#endif
#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD ""
#endif

#ifndef WIFI_TX_POWER
#define WIFI_TX_POWER WIFI_POWER_8_5dBm
#endif

#ifndef WIFI_COUNTRY_CC
#define WIFI_COUNTRY_CC "US"
#endif

#ifndef USE_ESP_WIFI_TUNING
#define USE_ESP_WIFI_TUNING 1
#endif

// Board: ESP32-C3 Super Mini. Arduino IDE: ESP32C3 Dev Module, USB CDC On Boot -> Enabled.
// WPA2 Personal (PSK). ESP32-C3 Wi-Fi is 2.4 GHz only — set WIFI_SSID / WIFI_PASSWORD in secrets.h.
// Native USB is on GPIO18/19 (internal). GPIO20/21 are the hardware UART pins.
// HX711: DT=GPIO4, SCK=GPIO3. Onboard status LED: GPIO8 (active low).

HX711 scale;
Preferences prefs;

uint8_t dataPin = 4;
uint8_t clockPin = 3;
float_t factor = 717.056;

bool isItemOn = false;
bool lastItemOnState = false;

int read_samples = 3;  // Lower = faster. Stability is handled separately below.

const int LED_PIN = 8;

const float ITEM_ON_THRESHOLD = 5.0;
const float ITEM_OFF_THRESHOLD = 3.0;   // Hysteresis to avoid flicker around 5g

const float STABLE_DELTA = 1.5;         // Max change between readings to count as stable
const int STABLE_READS_REQUIRED = 3;    // 3 stable reads before reporting

const int MAX_MEM_ITEMS = 9;
const float DEFAULT_MEM_MATCH_TOLERANCE = 4.0;

float memMatchTolerance = DEFAULT_MEM_MATCH_TOLERANCE;

float memWeights[MAX_MEM_ITEMS + 1];    // Use indexes 1..9
bool memEnabled[MAX_MEM_ITEMS + 1];

bool pendingStateChange = false;
bool pendingItemState = false;

float lastCandidateWeight = 0.0;
float stableWeight = 0.0;
float latestWeight = 0.0;
int stableReadCount = 0;

static const unsigned long REGISTER_INTERVAL_MS = 5UL * 60UL * 1000UL;
static unsigned long gLastRegistryPostMs = 0;

WebSocketsServer webSocket(81);
static WiFiClientSecure sTls;
static bool sTlsReady = false;

static const char* wlReason(int s) {
  switch (s) {
    case WL_IDLE_STATUS: return "IDLE";
    case WL_NO_SSID_AVAIL: return "NO_SSID_AVAIL";
    case WL_SCAN_COMPLETED: return "SCAN_COMPLETED";
    case WL_CONNECTED: return "CONNECTED";
    case WL_CONNECT_FAILED: return "CONNECT_FAILED";
    case WL_CONNECTION_LOST: return "CONNECTION_LOST";
    case WL_DISCONNECTED: return "DISCONNECTED";
    default: return "UNKNOWN";
  }
}

static void applyCountryAndProtocol() {
#if USE_ESP_WIFI_TUNING
  wifi_country_t country = {};
  strncpy(country.cc, WIFI_COUNTRY_CC, sizeof(country.cc));
  country.cc[sizeof(country.cc) - 1] = '\0';
  country.schan = 1;
  country.nchan = (strcmp(country.cc, "US") == 0) ? 11 : 13;
  country.policy = WIFI_COUNTRY_POLICY_MANUAL;
  esp_err_t err = esp_wifi_set_country(&country);
  if (err != ESP_OK) {
    Serial.printf("[WiFi] esp_wifi_set_country: %s\n", esp_err_to_name(err));
  }
  esp_wifi_set_protocol(WIFI_IF_STA,
                        WIFI_PROTOCOL_11B | WIFI_PROTOCOL_11G | WIFI_PROTOCOL_11N);
#endif
}

static void prepareStaStack() {
  WiFi.persistent(false);
  WiFi.mode(WIFI_OFF);
  delay(200);
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true);
  delay(100);
  WiFi.setSleep(false);
  WiFi.setTxPower(WIFI_TX_POWER);
  applyCountryAndProtocol();
}

static void scanForTargetSsid() {
  Serial.println("[WiFi] scanning...");
  int n = WiFi.scanNetworks(false, true);
  if (n < 0) {
    Serial.printf("[WiFi] scan failed (%d)\n", n);
    return;
  }
  bool seen = false;
  for (int i = 0; i < n; i++) {
    if (WiFi.SSID(i) != WIFI_SSID) continue;
    seen = true;
    Serial.printf("  \"%s\" RSSI=%d dBm ch=%u enc=%d\n", WIFI_SSID, WiFi.RSSI(i),
                  WiFi.channel(i), (int)WiFi.encryptionType(i));
  }
  if (!seen) {
    Serial.println(
        "[WiFi] target SSID not seen - check SSID, 2.4 GHz, distance, antenna.");
  }
}

static bool connectWifi() {
  Serial.printf("Connecting to \"%s\" (WPA2 Personal)...\n", WIFI_SSID);
  Serial.flush();

  prepareStaStack();
  scanForTargetSsid();

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  const uint32_t timeoutMs = 60000;
  uint32_t start = millis();
  int last = -1;

  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > timeoutMs) {
      Serial.println("\nTimeout - not connected. Last status:");
      Serial.println(wlReason(WiFi.status()));
      return false;
    }

    int st = WiFi.status();
    if (st != last) {
      last = st;
      Serial.printf("\n[WiFi] %s (%d)\n", wlReason(st), st);
    } else {
      Serial.print(".");
    }
    delay(500);
  }

  Serial.println();
  Serial.print("Connected, IP: ");
  Serial.println(WiFi.localIP());
  Serial.printf("[WiFi] TX power (getTxPower): %d\n", (int)WiFi.getTxPower());
  Serial.println("WebSocket server on port 81 (ws://<ip>:81/)");
  return true;
}

static String jsonQuoted(const char* raw) {
  String out = "\"";
  if (!raw) raw = "";
  for (const char* p = raw; *p; p++) {
    if (*p == '"' || *p == '\\') {
      out += '\\';
      out += *p;
    } else if ((unsigned char)*p < 0x20U) {
      continue;
    } else {
      out += *p;
    }
  }
  out += '"';
  return out;
}

static void registerWithCloud() {
  if (!REGISTER_BASE_URL || !REGISTER_BASE_URL[0]) return;
  if (!REGISTER_SECRET || !REGISTER_SECRET[0]) return;
  if (WiFi.status() != WL_CONNECTED) return;

  if (!sTlsReady) {
    sTls.setInsecure();
    sTlsReady = true;
  }

  HTTPClient http;
  String url = String(REGISTER_BASE_URL) + "/register";
  if (!http.begin(sTls, url)) {
    Serial.println("[Registry] http.begin failed");
    return;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + REGISTER_SECRET);

  String mac = WiFi.macAddress();
  String body = String("{\"mac\":\"") + mac + "\",\"device_id\":" + jsonQuoted(DEVICE_CODE_ID) +
                ",\"wifi_ssid\":" + jsonQuoted(WIFI_SSID) + ",\"lan_ip\":\"" +
                WiFi.localIP().toString() + "\"}";

  int code = http.POST(body);
  Serial.printf("[Registry] POST /register -> HTTP %d\n", code);
  if (code > 0) {
    Serial.println(http.getString());
  }
  http.end();
}

static void emitNotifyLine(const char* line) {
  Serial.println(line);
  webSocket.broadcastTXT(line);
}

static void emitNotifyWeight(float weight) {
  char buf[32];
  snprintf(buf, sizeof(buf), "notify_weight: %.2f", weight);
  emitNotifyLine(buf);
}

void setup() {
    delay(1000);
    Serial.begin(115200);
    delay(1000);
    Serial.println();
    Serial.printf("ESP32 Weight Sensor v4\n");
    Serial.printf("type 'help' for list of commands\n");

    pinMode(LED_PIN, OUTPUT);
    turnLedOff();

    scale.begin(dataPin, clockPin);
    scale.set_scale(factor);

    while (!scale.is_ready()) {
        Serial.println("Waiting for HX711...");
        delay(100);
    }

    prefs.begin("scale", true);
    long offset = prefs.getLong("offset", 0);
    memMatchTolerance = prefs.getFloat("tol", DEFAULT_MEM_MATCH_TOLERANCE);
    prefs.end();

    scale.set_offset(offset);
    Serial.printf("Restored offset: %ld\n", offset);
    Serial.printf("Restored mem_tolerance: %.2f\n", memMatchTolerance);

    loadMemWeights();
    warnIfAnyMemOverlaps();

    if (!connectWifi()) {
        Serial.println("Rebooting in 10 s...");
        delay(10000);
        ESP.restart();
    }

    webSocket.begin();
    registerWithCloud();
    gLastRegistryPostMs = millis();

    turnLedOn();
    Serial.println("Ready.");
}

void loop() {
    webSocket.loop();

    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[WiFi] lost connection, reconnecting...");
        if (connectWifi()) {
            registerWithCloud();
            gLastRegistryPostMs = millis();
        }
        return;
    }

    if (REGISTER_BASE_URL && REGISTER_BASE_URL[0] && REGISTER_SECRET &&
        REGISTER_SECRET[0] &&
        millis() - gLastRegistryPostMs > REGISTER_INTERVAL_MS) {
        gLastRegistryPostMs = millis();
        registerWithCloud();
    }

    static String inputString = "";

    while (Serial.available()) {
        char inChar = (char)Serial.read();

        if (inChar == '\n' || inChar == '\r') {
            inputString.trim();

            if (inputString.length() > 0) {
                handleCommand(inputString);
            }

            inputString = "";
        } else {
            inputString += inChar;
        }
    }

    if (scale.is_ready()) {
        float weight = scale.get_units(read_samples);
        latestWeight = weight;

        checkItemStateWithStableWeight(weight);
    }

    delay(100);
}

void handleCommand(String command) {
    if (command == "do_tare") {
        doTare();
    } else if (command == "check_item") {
        Serial.println(isItemOn ? "status_item_on" : "status_item_off");
    } else if (command == "list_mems") {
        listMems();
    } else if (command == "clear_mems") {
        clearMems();
    } else if (command == "get_mem_tolerance") {
        Serial.printf("mem_tolerance: %.2f\n", memMatchTolerance);
    } else if (command.startsWith("set_mem_tolerance")) {
        handleSetMemToleranceCommand(command);
    } else if (command.startsWith("set_mem_")) {
        handleSetMemCommand(command);
    } else if (command.startsWith("unset_mem_")) {
        handleUnsetMemCommand(command);
    } else if (command.startsWith("get_mem_")) {
        handleGetMemCommand(command);
    } else if (command == "help") {
    printHelp();
    } else {
        Serial.println("ERROR: unknown_command");
    }
}

void printHelp() {
    Serial.println("Available commands:");
    Serial.println("  help");
    Serial.println("  do_tare");
    Serial.println("  check_item");
    Serial.println("  set_mem_1 ... set_mem_9");
    Serial.println("  unset_mem_1 ... unset_mem_9");
    Serial.println("  get_mem_1 ... get_mem_9");
    Serial.println("  list_mems");
    Serial.println("  clear_mems");
    Serial.println("  set_mem_tolerance <value>");
    Serial.println("  get_mem_tolerance");
}

void checkItemStateWithStableWeight(float currentWeight) {
    bool measuredItemState = isItemOn;

    // Hysteresis:
    // If currently off, require >= 5g to turn on.
    // If currently on, require <= 3g to turn off.
    if (!isItemOn && currentWeight >= ITEM_ON_THRESHOLD) {
        measuredItemState = true;
    } else if (isItemOn && currentWeight <= ITEM_OFF_THRESHOLD) {
        measuredItemState = false;
    }

    // No state change detected.
    if (measuredItemState == isItemOn) {
        pendingStateChange = false;
        stableReadCount = 0;
        return;
    }

    // New possible state change.
    if (!pendingStateChange || measuredItemState != pendingItemState) {
        pendingStateChange = true;
        pendingItemState = measuredItemState;
        lastCandidateWeight = currentWeight;
        stableWeight = currentWeight;
        stableReadCount = 0;
        return;
    }

    // Still moving too much; reset stability count.
    if (fabs(currentWeight - lastCandidateWeight) > STABLE_DELTA) {
        lastCandidateWeight = currentWeight;
        stableWeight = currentWeight;
        stableReadCount = 0;
        return;
    }

    // Stable enough for this read.
    stableWeight = currentWeight;
    stableReadCount++;

    if (stableReadCount >= STABLE_READS_REQUIRED) {
        isItemOn = pendingItemState;

        if (isItemOn) {
            int matchedId = findMatchingMemSlot(stableWeight);

            if (matchedId > 0) {
                char buf[24];
                snprintf(buf, sizeof(buf), "notify_item_%d", matchedId);
                emitNotifyLine(buf);
            } else {
                emitNotifyLine("notify_item_on");
            }

            emitNotifyWeight(stableWeight);
        } else {
            emitNotifyLine("notify_item_off");
            emitNotifyWeight(0.0);
        }

        lastItemOnState = isItemOn;
        pendingStateChange = false;
        stableReadCount = 0;
    }
}

void handleSetMemCommand(String command) {
    int id = command.substring(8).toInt();  // "set_mem_1" -> 1

    if (id < 1 || id > MAX_MEM_ITEMS) {
        Serial.println("set_mem_ERROR: invalid_id");
        return;
    }

    if (!scale.is_ready()) {
        Serial.println("set_mem_ERROR: scale_not_ready");
        return;
    }

    // Take a stronger reading when memorizing.
    float weight = scale.get_units(10);
    latestWeight = weight;

    if (weight < ITEM_ON_THRESHOLD) {
        Serial.println("set_mem_ERROR: no_item_detected");
        return;
    }

    int overlappingId = findOverlappingMemSlot(id, weight);

    if (overlappingId > 0) {
        Serial.printf(
            "set_mem_%d_ERROR: overlaps_mem_%d existing=%.2f new=%.2f tolerance=%.2f\n",
            id,
            overlappingId,
            memWeights[overlappingId],
            weight,
            memMatchTolerance
        );
        return;
    }

    memWeights[id] = weight;
    memEnabled[id] = true;

    saveMemSlot(id);

    Serial.printf("set_mem_%d_OK: %.2f\n", id, weight);
}

void handleUnsetMemCommand(String command) {
    int id = command.substring(10).toInt();  // "unset_mem_1" -> 1

    if (id < 1 || id > MAX_MEM_ITEMS) {
        Serial.println("unset_mem_ERROR: invalid_id");
        return;
    }

    memWeights[id] = 0.0;
    memEnabled[id] = false;

    saveMemSlot(id);

    Serial.printf("unset_mem_%d_OK\n", id);
}

void handleGetMemCommand(String command) {
    int id = command.substring(8).toInt();  // "get_mem_1" -> 1

    if (id < 1 || id > MAX_MEM_ITEMS) {
        Serial.println("get_mem_ERROR: invalid_id");
        return;
    }

    if (!memEnabled[id]) {
        Serial.printf("mem_%d: unset\n", id);
        return;
    }

    Serial.printf("mem_%d: %.2f\n", id, memWeights[id]);
}

void handleSetMemToleranceCommand(String command) {
    // Expected format:
    // set_mem_tolerance 4.0

    int spaceIndex = command.indexOf(' ');

    if (spaceIndex < 0) {
        Serial.println("set_mem_tolerance_ERROR: missing_value");
        return;
    }

    String valueString = command.substring(spaceIndex + 1);
    valueString.trim();

    float newTolerance = valueString.toFloat();

    if (newTolerance <= 0.0) {
        Serial.println("set_mem_tolerance_ERROR: invalid_value");
        return;
    }

    memMatchTolerance = newTolerance;

    prefs.begin("scale", false);
    prefs.putFloat("tol", memMatchTolerance);
    prefs.end();

    Serial.printf("set_mem_tolerance_OK: %.2f\n", memMatchTolerance);

    // Changing tolerance may make existing memories overlap.
    warnIfAnyMemOverlaps();
}

void listMems() {
    Serial.printf("mem_tolerance: %.2f\n", memMatchTolerance);

    bool anySet = false;

    for (int i = 1; i <= MAX_MEM_ITEMS; i++) {
        if (memEnabled[i]) {
            Serial.printf("mem_%d: %.2f\n", i, memWeights[i]);
            anySet = true;
        } else {
            Serial.printf("mem_%d: unset\n", i);
        }
    }

    if (!anySet) {
        Serial.println("list_mems: empty");
    }

    warnIfAnyMemOverlaps();
}

void clearMems() {
    for (int i = 1; i <= MAX_MEM_ITEMS; i++) {
        memWeights[i] = 0.0;
        memEnabled[i] = false;
        saveMemSlot(i);
    }

    Serial.println("clear_mems_OK");
}

void loadMemWeights() {
    prefs.begin("scale", true);

    for (int i = 1; i <= MAX_MEM_ITEMS; i++) {
        char weightKey[8];
        char enabledKey[8];

        snprintf(weightKey, sizeof(weightKey), "mem%d", i);
        snprintf(enabledKey, sizeof(enabledKey), "men%d", i);

        memWeights[i] = prefs.getFloat(weightKey, 0.0);
        memEnabled[i] = prefs.getBool(enabledKey, false);

        if (memEnabled[i]) {
            Serial.printf("Restored mem_%d: %.2f\n", i, memWeights[i]);
        }
    }

    prefs.end();
}

void saveMemSlot(int id) {
    prefs.begin("scale", false);

    char weightKey[8];
    char enabledKey[8];

    snprintf(weightKey, sizeof(weightKey), "mem%d", id);
    snprintf(enabledKey, sizeof(enabledKey), "men%d", id);

    prefs.putFloat(weightKey, memWeights[id]);
    prefs.putBool(enabledKey, memEnabled[id]);

    prefs.end();
}

int findMatchingMemSlot(float weight) {
    int bestMatch = 0;
    float bestDiff = memMatchTolerance;

    for (int i = 1; i <= MAX_MEM_ITEMS; i++) {
        if (!memEnabled[i]) {
            continue;
        }

        float diff = fabs(weight - memWeights[i]);

        if (diff <= bestDiff) {
            bestDiff = diff;
            bestMatch = i;
        }
    }

    return bestMatch;
}

int findOverlappingMemSlot(int idToIgnore, float newWeight) {
    for (int i = 1; i <= MAX_MEM_ITEMS; i++) {
        if (i == idToIgnore || !memEnabled[i]) {
            continue;
        }

        if (memWeightsOverlap(newWeight, memWeights[i])) {
            return i;
        }
    }

    return 0;
}

bool memWeightsOverlap(float weightA, float weightB) {
    return fabs(weightA - weightB) <= (memMatchTolerance * 2.0);
}

bool warnIfAnyMemOverlaps() {
    bool foundOverlap = false;

    for (int i = 1; i <= MAX_MEM_ITEMS; i++) {
        if (!memEnabled[i]) {
            continue;
        }

        for (int j = i + 1; j <= MAX_MEM_ITEMS; j++) {
            if (!memEnabled[j]) {
                continue;
            }

            if (memWeightsOverlap(memWeights[i], memWeights[j])) {
                Serial.printf(
                    "WARNING: mem_%d overlaps mem_%d weight_%d=%.2f weight_%d=%.2f tolerance=%.2f\n",
                    i,
                    j,
                    i,
                    memWeights[i],
                    j,
                    memWeights[j],
                    memMatchTolerance
                );

                foundOverlap = true;
            }
        }
    }

    return foundOverlap;
}

void doTare() {
    turnLedOff();
    Serial.println("Taring...");

    // Tare must be done with the scale empty / at rest.
    scale.tare(20);

    long newOffset = scale.get_offset();

    prefs.begin("scale", false);
    prefs.putLong("offset", newOffset);
    prefs.end();

    isItemOn = false;
    lastItemOnState = false;

    pendingStateChange = false;
    pendingItemState = false;
    lastCandidateWeight = 0.0;
    stableWeight = 0.0;
    latestWeight = 0.0;
    stableReadCount = 0;

    Serial.printf("tare_OK, saved offset: %ld\n", newOffset);
    turnLedOn();
}

void turnLedOn() {
    digitalWrite(LED_PIN, false);
}

void turnLedOff() {
    digitalWrite(LED_PIN, true);
}
