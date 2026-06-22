"use strict";

const creator = new URLSearchParams(window.location.search).get("creator");
const viewer = new URLSearchParams(window.location.search).get("viewer");

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

function preload() {
  oilTextureImg = loadImage("assets/oil-texture-reference.png");
}

function setup() {
  pixelDensity(1);
  createCanvas(windowWidth, windowHeight);
  frameRate(8);
  textFont("monospace");
  initializeTowers();
}

function draw() {
  renderScene();
  frameRate(hasActiveLayerAnimations() ? 30 : 8);
}

function keyPressed() {
  const lower = key.toLowerCase();
  if (lower === "f") {
    fullscreen(!fullscreen());
    return false;
  }
  if (lower === "s") {
    addLayer("square");
  } else if (lower === "r") {
    addLayer("rectH");
  } else if (lower === "p") {
    saveCanvas("naive-babel-study", "png");
  }
  return false;
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

function pickTextureCrop(maxW, maxH) {
  if (!oilTextureImg || !oilTextureImg.width) {
    return { sx: 0, sy: 0, sw: 1, sh: 1 };
  }
  const sw = min(maxW, oilTextureImg.width);
  const sh = min(maxH, oilTextureImg.height);
  const sx = floor(random(max(1, oilTextureImg.width - sw)));
  const sy = floor(random(max(1, oilTextureImg.height - sh)));
  return { sx, sy, sw, sh };
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
  const rectCrop = pickTextureCrop(220, 220);
  const triCrop = pickTextureCrop(240, 240);
  const wearSeed = floor(random(999999));

  targetTower.layers.push({
    shapeType,
    message,
    colorHex: random(blockPalette),
    rectHeightFactor: random(0.5, 0.72),
    jitterX: 0,
    bubbleSide: random() < 0.5 ? "left" : "right",
    bubbleOffsetX: random(28, 72),
    bubbleOffsetY: random(-10, 10),
    ghostBornAt: millis(),
    rectTexture: rectCrop,
    triTexture: triCrop,
    wearSeed
  });

  return towerIndex;
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
  drawTower();
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
  const pulse = 0.94 + 0.06 * sin(frameCount * 0.045);
  noStroke();
  fill(180, 85, 36, 220);
  circle(workX + workW * 0.66, workY + workH * 0.2, workW * 0.13 * pulse);
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
      drawBlock(x, y, dim.w, dim.h, layer);

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
  return {
    active: true,
    scale: lerp(1, 2.35, pow(t, 0.7)),
    alpha: lerp(175, 0, pow(t, 1.75))
  };
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

function drawBlock(x, y, w, h, layer) {
  const frontColor = color(layer.colorHex);
  noStroke();
  if (layer.shapeType === "triangle") {
    fill(frontColor);
    triangle(x, y + h, x + w * 0.5, y, x + w, y + h);
    applyOilTextureToTriangle(x, y, w, h, layer.triTexture);
    fill(255, 18);
    triangle(x, y + h, x + w * 0.5, y, x + w, y + h);
    drawPaintWear(x, y, w, h, true, layer.wearSeed);
  } else {
    fill(frontColor);
    rect(x, y, w, h);
    applyOilTextureToRect(x, y, w, h, layer.rectTexture);
    fill(255, 18);
    rect(x, y, w, h);
    drawPaintWear(x, y, w, h, false, layer.wearSeed);
  }
}

function drawPaintWear(x, y, w, h, isTriangle, wearSeed) {
  randomSeed(wearSeed);
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
  randomSeed();
}

function applyOilTextureToRect(x, y, w, h, crop) {
  if (!oilTextureImg || !crop) {
    return;
  }
  push();
  blendMode(MULTIPLY);
  tint(255, 88);
  image(oilTextureImg, x, y, w, h, crop.sx, crop.sy, crop.sw, crop.sh);
  pop();
}

function applyOilTextureToTriangle(x, y, w, h, crop) {
  if (!oilTextureImg || !crop) {
    return;
  }
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
  image(oilTextureImg, x, y, w, h, crop.sx, crop.sy, crop.sw, crop.sh);
  blendMode(BLEND);
  noTint();
  ctx.restore();
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
    out += ch === " " ? " " : charset[floor(random(charset.length))];
  }
  return out;
}

function s(value) {
  return value * scaleFactor;
}

// Teia wallet context (reserved for future collector features)
void creator;
void viewer;
