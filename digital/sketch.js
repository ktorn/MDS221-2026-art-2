let borderPad;
let workX;
let workY;
let workW;
let workH;
let horizonY;
let groundY;
let oilTextureImg;
let scaleFactor = 1;
let blockUnit = 72;
let layoutSizeKey = "";

const towers = [];

const layerMessages = [
  "English: We build upward.",
  "中文: 我们一层一层向上堆叠。",
  "日本語: 一段ずつ積み上げる。",
  "Italiano: Strato dopo strato cresciamo.",
  "Русский: Башня растет по слоям.",
  "Francais: Chaque couche tient la suivante.",
  "Portugues: A torre sobe com equilibrio.",
  "Espanol: La torre respira en silencio."
];

const blockPalette = [
  "#c73d2f", "#b63128", "#1f3e55", "#2f6f63", "#d7b04f",
  "#e6c759", "#7d2f40", "#2b2323", "#9c4f43", "#4d713f"
];

const BOX_W = 280;
const BOX_H = 24;
const BASE_SIZE = 72;
const LAYER_GAP = 6;
const GAP_RATIO = LAYER_GAP / BASE_SIZE;
const FADE_DEPTH = 8;
const TOWER_COUNT = 4;
const MAX_LAYERS = 8;
const AUTO_TRIANGLE_LAYER_INDEX = 7;
const REF_WIDTH = 1920;
const REF_HEIGHT = 1080;
const SQUARE_H_FACTOR = 1.0;
const RECT_H_FACTOR = 0.64;
const TRIANGLE_H_FACTOR = 0.92;
const LAYER_GHOST_MS = 720;
const MAX_LAYER_WIDTH_FACTOR = 2.05;
const RECT_ALLOCATION_RATIO = 0.8;

const APP_SECRETS = window.APP_SECRETS || {};
const REGISTRY_BASE_URL =
  APP_SECRETS.registryBaseUrl || "https://esp-device-registry.ktorn.workers.dev";
const DEFAULT_DEVICE_ID = APP_SECRETS.deviceId || "MDS221-2026-2";

const ITEM_SHAPE_MAP = {
  1: "square",
  2: "rectH",
};

const URL_CONFIG = readUrlConfig();
let wsUrl = hasDirectWs(URL_CONFIG)
  ? URL_CONFIG.ws || `ws://${URL_CONFIG.wsHost}:${URL_CONFIG.wsPort}`
  : null;
let registryState = needsRegistryLookup(URL_CONFIG)
  ? "resolving"
  : hasDirectWs(URL_CONFIG)
    ? "bypassed"
    : "no token";

let socket = null;
let socketStatus = "idle";
let lastWeightMessage = "";
let lastMessageAt = 0;
let showSensorPane = false;
let sensorPendingCommand = null;
let sensorLog = [];
const SENSOR_LOG_MAX = 16;

function preload() {
  oilTextureImg = loadImage("assets/oil-texture-reference.png");
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  frameRate(8);
  textFont("monospace");
  initializeTowers();
  initWebSocketConnection();
}

function draw() {
  renderScene();
  frameRate(hasActiveLayerAnimations() ? 30 : 8);
}

function keyPressed() {
  if (keyCode === ESCAPE) {
    showSensorPane = false;
    sensorPendingCommand = null;
    return false;
  }

  const lower = key.toLowerCase();

  if (lower === "f") {
    fullscreen(!fullscreen());
    return false;
  }

  if (lower === "s" && !showSensorPane) {
    showSensorPane = true;
    sensorPendingCommand = null;
    return false;
  }

  if (showSensorPane && handleSensorPaneKey(key)) {
    return false;
  }

  if (lower === "r") {
    addLayer("rectH");
  } else if (lower === "p") {
    saveCanvas("naive-babel-tower", "png");
  }
  return false;
}

function handleSensorPaneKey(key) {
  if (sensorPendingCommand === "set" || sensorPendingCommand === "unset") {
    const digit = parseInt(key, 10);
    if (digit >= 1 && digit <= 9) {
      const command =
        sensorPendingCommand === "set"
          ? `set_mem_${digit}`
          : `unset_mem_${digit}`;
      sendEspCommand(command);
      sensorPendingCommand = null;
      return true;
    }
    appendSensorLog(`cancelled (expected 1-9, got "${key}")`);
    sensorPendingCommand = null;
    return true;
  }

  const lower = key.toLowerCase();
  if (lower === "s") {
    if (key === "S") {
      showSensorPane = false;
      sensorPendingCommand = null;
      return true;
    }
    sensorPendingCommand = "set";
    appendSensorLog("set mem: press 1-9…");
    return true;
  }
  if (lower === "u") {
    sensorPendingCommand = "unset";
    appendSensorLog("unset mem: press 1-9…");
    return true;
  }
  if (lower === "r") {
    sendEspCommand("clear_mems");
    return true;
  }
  if (lower === "l") {
    sendEspCommand("list_mems");
    return true;
  }
  if (lower === "t") {
    sendEspCommand("do_tare");
    return true;
  }
  return false;
}

function sendEspCommand(command) {
  appendSensorLog(`> ${command}`);
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    appendSensorLog("ERROR: WebSocket not connected");
    return;
  }
  socket.send(command);
}

function appendSensorLog(line) {
  sensorLog.push(line);
  if (sensorLog.length > SENSOR_LOG_MAX) {
    sensorLog.shift();
  }
}

function handleWebSocketMessage(rawLine) {
  const trimmed = rawLine.trim();
  if (!trimmed) {
    return;
  }

  if (trimmed.startsWith("notify_")) {
    handleWeightMessage(trimmed);
    return;
  }

  appendSensorLog(trimmed);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  layoutSizeKey = "";
}

function initializeTowers() {
  towers.length = 0;
  for (let i = 0; i < TOWER_COUNT; i++) {
    const centerDistance = abs(i - (TOWER_COUNT - 1) * 0.5);
    const weightBoost = map(centerDistance, 0, (TOWER_COUNT - 1) * 0.5, 1.35, 0.9);
    towers.push({
      layers: [],
      xFactor: (i + 0.5) / TOWER_COUNT,
      growthWeight: weightBoost
    });
  }
}

function addLayer(requestedShapeType) {
  const towerIndex = pickTowerIndex();
  if (towerIndex === -1) {
    return -1;
  }

  const targetTower = towers[towerIndex];
  const layerCount = targetTower.layers.length;
  const shouldForceTriangle = layerCount === AUTO_TRIANGLE_LAYER_INDEX;
  const requested = requestedShapeType === "rectH" ? "rectH" : "square";
  const shapeType = shouldForceTriangle ? "triangle" : requested;
  const messageIndex = getTotalLayers() % layerMessages.length;
  const message = layerMessages[messageIndex];

  targetTower.layers.push({
    shapeType,
    message,
    colorHex: random(blockPalette),
    rectWidthFactor: random(1.45, 2.05),
    rectHeightFactor: random(0.5, 0.72),
    jitterX: 0,
    bubbleSide: random() < 0.5 ? "left" : "right",
    bubbleOffsetX: random(28, 72),
    bubbleOffsetY: random(-10, 10),
    ghostBornAt: millis()
  });

  return towerIndex;
}

function shapeForItemId(itemId) {
  return ITEM_SHAPE_MAP[itemId] || "square";
}

function handleWeightMessage(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("notify_")) {
    return;
  }

  lastWeightMessage = trimmed;

  const itemMatch = trimmed.match(/^notify_item_(\d+)$/);
  if (itemMatch) {
    const itemId = parseInt(itemMatch[1], 10);
    addLayer(shapeForItemId(itemId));
    return;
  }

  if (trimmed === "notify_item_on") {
    addLayer("square");
  }

  // notify_item_off: item lifted from scale — towers keep growing; blocks are reused.
}

function readUrlConfig() {
  const params = new URLSearchParams(window.location.search);
  const wsHost = params.get("wsHost") || params.get("host");
  return {
    deviceId: params.get("deviceId") || DEFAULT_DEVICE_ID,
    token: params.get("token") || APP_SECRETS.registryToken || null,
    registry: params.get("registry") || REGISTRY_BASE_URL,
    ws: params.get("ws"),
    wsHost,
    wsPort: params.get("wsPort") || params.get("port") || "81",
  };
}

function hasDirectWs(config) {
  return !!(config.ws || config.wsHost);
}

function needsRegistryLookup(config) {
  return !hasDirectWs(config) && !!(config.deviceId && config.token);
}

async function lookupDeviceEndpoint(config) {
  const base = config.registry.replace(/\/$/, "");
  const url = new URL(`${base}/lookup`);
  url.searchParams.set("device_id", config.deviceId);
  url.searchParams.set("token", config.token);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`lookup ${res.status}`);
  }
  const data = await res.json();
  if (!data.lan_ip) throw new Error("no lan_ip");
  const port = data.ws_port || 81;
  return `ws://${data.lan_ip}:${port}`;
}

function initWebSocketConnection() {
  if (needsRegistryLookup(URL_CONFIG)) {
    lookupDeviceEndpoint(URL_CONFIG)
      .then((url) => {
        wsUrl = url;
        registryState = "ok";
        connectWebSocket();
      })
      .catch((err) => {
        registryState = err.message || "failed";
        socketStatus = `registry ${registryState}`;
      });
  } else if (hasDirectWs(URL_CONFIG)) {
    registryState = "bypassed";
    connectWebSocket();
  } else {
    connectWebSocket();
  }
}

function connectWebSocket() {
  if (socket && socket.readyState === WebSocket.OPEN) return;
  if (!wsUrl) {
    socketStatus =
      registryState === "resolving"
        ? "registry lookup…"
        : needsRegistryLookup(URL_CONFIG)
          ? `registry ${registryState}`
          : "set secrets.js or ?wsHost=";
    return;
  }

  socketStatus = `connecting ${wsUrl}...`;

  try {
    socket = new WebSocket(wsUrl);
  } catch (error) {
    socketStatus = `WebSocket error: ${error.message}`;
    return;
  }

  socket.onopen = () => {
    socketStatus = `connected ${wsUrl.replace(/^ws:\/\//, "")}`;
  };

  socket.onclose = () => {
    socketStatus = "disconnected (retry in 2s)";
    setTimeout(connectWebSocket, 2000);
  };

  socket.onerror = () => {
    socketStatus = "socket error";
  };

  socket.onmessage = (event) => {
    handleWebSocketMessage(String(event.data));
    lastMessageAt = millis();
  };
}

function pickTowerIndex() {
  const candidates = [];
  let totalWeight = 0;

  for (let i = 0; i < towers.length; i++) {
    const layerCount = towers[i].layers.length;
    if (layerCount >= MAX_LAYERS) {
      continue;
    }

    const heightPenalty = map(layerCount, 0, MAX_LAYERS, 1, 0.28);
    const weight = towers[i].growthWeight * heightPenalty;
    candidates.push({ i, weight });
    totalWeight += weight;
  }

  if (candidates.length === 0) {
    return -1;
  }

  let r = random(totalWeight);
  for (const candidate of candidates) {
    r -= candidate.weight;
    if (r <= 0) {
      return candidate.i;
    }
  }

  return candidates[candidates.length - 1].i;
}

function getTotalLayers() {
  let total = 0;
  for (const tower of towers) {
    total += tower.layers.length;
  }
  return total;
}

function renderScene() {
  background(217, 217, 217);
  drawFrameAndPanel();
  drawBackgroundTexture();
  drawInstruction();
  drawTower();
  if (showSensorPane) {
    drawSensorPane();
  }
}

function getTowerAllocationWidth() {
  return workW / TOWER_COUNT;
}

function getRectBlockWidth() {
  return getTowerAllocationWidth() * RECT_ALLOCATION_RATIO;
}

function updateTowerLayoutForViewport() {
  for (let i = 0; i < towers.length; i++) {
    towers[i].xFactor = (i + 0.5) / TOWER_COUNT;
  }
}

function syncLayoutMetrics() {
  borderPad = 0;
  workX = 0;
  workY = 0;
  workW = width;
  workH = height;
  scaleFactor = min(workW / REF_WIDTH, workH / REF_HEIGHT);
  horizonY = workY + workH * 0.52;
  groundY = workY + workH - s(12);
  updateTowerLayoutForViewport();
}

function recomputeBlockUnitIfNeeded() {
  const key = `${width}x${height}`;
  if (key === layoutSizeKey) {
    return;
  }
  layoutSizeKey = key;
  blockUnit = computeBlockUnit();
}

function computeBlockUnit() {
  const widthUnit = getRectBlockWidth() / MAX_LAYER_WIDTH_FACTOR;
  const targetTopY = workY + workH * (height > width ? 0.14 : 0.2);
  const targetTowerHeight = max(80, groundY - targetTopY);
  const randomLayerCount = MAX_LAYERS - 1;
  const randomAvgHeightFactor = (SQUARE_H_FACTOR + RECT_H_FACTOR) * 0.5;
  const totalHeightFactor =
    randomLayerCount * randomAvgHeightFactor +
    TRIANGLE_H_FACTOR +
    (MAX_LAYERS - 1) * GAP_RATIO;
  const heightUnit = targetTowerHeight / totalHeightFactor;
  return min(heightUnit, widthUnit);
}

function drawFrameAndPanel() {
  syncLayoutMetrics();
  recomputeBlockUnitIfNeeded();

  noStroke();
  fill(85, 25, 27, 238);
  rect(workX, workY, workW, workH);
}

function drawBackgroundTexture() {
  noStroke();
  fill(180, 85, 36, 220);
  circle(workX + workW * 0.66, workY + workH * 0.2, workW * 0.13);
}

function drawInstruction() {
  noStroke();
  fill(242, 226, 200, 220);
  textSize(s(14));
  textAlign(LEFT, TOP);
  text("4 towers, 8 floors each. Top floor is triangle.", workX + s(16), workY + s(14));
  text("S: sensor pane | F: fullscreen | Esc: close | R: test rect | P: save", workX + s(16), workY + s(34));
  text(`Total layers: ${getTotalLayers()} / ${TOWER_COUNT * MAX_LAYERS}`, workX + s(16), workY + s(54));
  text(`WebSocket: ${socketStatus}`, workX + s(16), workY + s(74));
  if (lastWeightMessage) {
    text(`Last event: ${lastWeightMessage}`, workX + s(16), workY + s(94));
  }
}

function drawSensorPane() {
  const paneW = min(workW * 0.42, s(520));
  const paneH = min(workH * 0.55, s(360));
  const paneX = workX + workW - paneW - s(16);
  const paneY = workY + s(120);
  const lineH = s(18);

  push();
  noStroke();
  fill(20, 20, 24, 230);
  rect(paneX, paneY, paneW, paneH, s(8));
  fill(245, 235, 220, 240);
  textSize(s(14));
  textAlign(LEFT, TOP);
  text("Sensor pane (S open | Esc or Shift+S close)", paneX + s(12), paneY + s(10));
  text("s + 1-9  set mem    u + 1-9  unset mem", paneX + s(12), paneY + s(30));
  text("l  list mems   r  reset all   t  tare", paneX + s(12), paneY + s(48));

  fill(245, 235, 220, 180);
  textSize(s(12));
  let y = paneY + s(72);
  const maxLines = floor((paneH - s(84)) / lineH);
  const start = max(0, sensorLog.length - maxLines);
  for (let i = start; i < sensorLog.length; i++) {
    text(sensorLog[i], paneX + s(12), y, paneW - s(24), lineH + s(2));
    y += lineH;
  }

  if (sensorPendingCommand) {
    fill(255, 220, 120, 240);
    text(
      sensorPendingCommand === "set" ? "Waiting: mem slot 1-9…" : "Waiting: unset slot 1-9…",
      paneX + s(12),
      paneY + paneH - s(28)
    );
  }
  pop();
}

function drawTower() {
  const scrambleOn = areAllTowersComplete();
  const flashOn = scrambleOn ? frameCount % 2 === 0 : false;

  for (const tower of towers) {
    let currentTop = groundY;
    const baseX = workX + workW * tower.xFactor;

    for (let i = 0; i < tower.layers.length; i++) {
      const layer = tower.layers[i];
      const dim = getLayerDimensions(layer);
      const x = baseX + layer.jitterX - dim.w * 0.5;
      const y = currentTop - dim.h;
      const phrase = scrambleOn ? scrambleText(layer.message) : layer.message;
      const cx = x + dim.w * 0.5;
      const cy = y + dim.h * 0.5;
      const ghost = getLayerEmanationGhost(layer);

      if (ghost.active) {
        drawLayerEmanatingGhost(layer, x, y, dim, cx, cy, ghost.scale, ghost.alpha);
      }

      drawBubblePhrase(
        tower.layers.length,
        i,
        x + dim.w * 0.5,
        y + dim.h * 0.5,
        dim.w,
        phrase,
        layer.bubbleSide,
        layer.bubbleOffsetX,
        layer.bubbleOffsetY,
        flashOn
      );
      drawBlock(x, y, dim.w, dim.h, layer.colorHex, layer.shapeType);

      currentTop = y - getLayerGap();
    }
  }
}

function areAllTowersComplete() {
  for (const tower of towers) {
    if (tower.layers.length < MAX_LAYERS) {
      return false;
    }
  }
  return true;
}

function getLayerDimensions(layer) {
  const shapeType = layer.shapeType;
  const base = blockUnit;
  if (shapeType === "square") {
    return { w: base * 1.2, h: base * SQUARE_H_FACTOR };
  }
  if (shapeType === "rectH") {
    return { w: getRectBlockWidth(), h: base * layer.rectHeightFactor };
  }
  return { w: base * 1.14, h: base * TRIANGLE_H_FACTOR };
}

function getLayerGap() {
  return blockUnit * GAP_RATIO;
}

function hasActiveLayerAnimations() {
  for (const tower of towers) {
    for (const layer of tower.layers) {
      if (layer.ghostBornAt != null && millis() - layer.ghostBornAt < LAYER_GHOST_MS) {
        return true;
      }
    }
  }
  return false;
}

function getLayerEmanationGhost(layer) {
  if (layer.ghostBornAt == null) {
    return { active: false };
  }

  const t = constrain((millis() - layer.ghostBornAt) / LAYER_GHOST_MS, 0, 1);
  if (t >= 1) {
    layer.ghostBornAt = null;
    return { active: false };
  }

  const scale = lerp(1, 2.35, pow(t, 0.7));
  const alpha = lerp(175, 0, pow(t, 1.75));

  return { active: true, scale, alpha };
}

function drawLayerEmanatingGhost(layer, x, y, dim, cx, cy, ghostScale, ghostAlpha) {
  if (ghostAlpha <= 2) {
    return;
  }

  push();
  drawingContext.globalAlpha = ghostAlpha / 255;
  translate(cx, cy);
  scale(ghostScale);
  translate(-cx, -cy);

  const blockColor = color(layer.colorHex);
  noStroke();
  fill(red(blockColor), green(blockColor), blue(blockColor), 120);
  if (layer.shapeType === "triangle") {
    triangle(x, y + dim.h, x + dim.w * 0.5, y, x + dim.w, y + dim.h);
  } else {
    rect(x, y, dim.w, dim.h);
  }

  fill(255, 250, 235, 90);
  if (layer.shapeType === "triangle") {
    triangle(x, y + dim.h, x + dim.w * 0.5, y, x + dim.w, y + dim.h);
  } else {
    rect(x, y, dim.w, dim.h);
  }
  pop();
}

function drawBlock(x, y, w, h, colorHex, shapeType) {
  const frontColor = color(colorHex);

  noStroke();
  if (shapeType === "triangle") {
    fill(frontColor);
    triangle(x, y + h, x + w * 0.5, y, x + w, y + h);
    applyOilTextureToTriangle(x, y, w, h);
    fill(255, 18);
    triangle(x, y + h, x + w * 0.5, y, x + w, y + h);
    drawPaintWear(x, y, w, h, true);
  } else {
    fill(frontColor);
    rect(x, y, w, h);
    applyOilTextureToRect(x, y, w, h);
    fill(255, 18);
    rect(x, y, w, h);
    drawPaintWear(x, y, w, h, false);
  }
}

function applyOilTextureToRect(x, y, w, h) {
  if (!oilTextureImg) {
    return;
  }

  const sx = random(max(1, oilTextureImg.width - 220));
  const sy = random(max(1, oilTextureImg.height - 220));
  const sw = min(220, oilTextureImg.width - sx);
  const sh = min(220, oilTextureImg.height - sy);

  push();
  blendMode(MULTIPLY);
  tint(255, 88);
  image(oilTextureImg, x, y, w, h, sx, sy, sw, sh);
  pop();
}

function applyOilTextureToTriangle(x, y, w, h) {
  if (!oilTextureImg) {
    return;
  }

  const sx = random(max(1, oilTextureImg.width - 240));
  const sy = random(max(1, oilTextureImg.height - 240));
  const sw = min(240, oilTextureImg.width - sx);
  const sh = min(240, oilTextureImg.height - sy);

  const ctx = drawingContext;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x + w * 0.5, y);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.clip();

  blendMode(MULTIPLY);
  tint(255, 92);
  image(oilTextureImg, x, y, w, h, sx, sy, sw, sh);
  blendMode(BLEND);
  noTint();
  ctx.restore();
}

function drawPaintWear(x, y, w, h, isTriangle) {
  // Subtle paint chips and brush streaks on each block.
  noStroke();
  for (let i = 0; i < 6; i++) {
    fill(255, random(8, 22));
    const rx = random(x + 2, x + w - 8);
    const ry = random(y + 2, y + h - 4);
    const rw = random(4, max(5, w * 0.2));
    const rh = random(2, max(3, h * 0.2));
    if (isTriangle) {
      ellipse(rx, ry, rw * 0.4, rh * 0.5);
    } else {
      rect(rx, ry, rw, rh);
    }
  }
}

function drawBubblePhrase(
  towerLength,
  index,
  blockCenterX,
  blockCenterY,
  blockW,
  textValue,
  side,
  offsetX,
  offsetY,
  flashOn
) {
  const depthFromTop = towerLength - 1 - index;
  const alpha = map(depthFromTop, 0, FADE_DEPTH, 230, 18, true);
  const flashAlpha = flashOn ? alpha * 0.35 : alpha;
  const allocationW = getTowerAllocationWidth();
  const outward = allocationW * 0.08 + s(offsetX * 0.45);
  const textX =
    side === "left"
      ? blockCenterX - blockW * 0.5 - outward
      : blockCenterX + blockW * 0.5 + outward;
  const textY = blockCenterY + s(offsetY);

  noStroke();
  fill(245, 235, 220, flashAlpha);
  textSize(max(11, allocationW * 0.042));
  textAlign(side === "left" ? RIGHT : LEFT, CENTER);
  text(textValue, textX, textY, allocationW * 0.95);
}

function scrambleText(source) {
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*?+=<>~";
  let out = "";
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === " ") {
      out += " ";
    } else {
      out += charset[floor(random(charset.length))];
    }
  }
  return out;
}

function s(value) {
  return value * scaleFactor;
}

