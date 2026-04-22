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
const RANDOM_LAYER_TYPES = ["square", "rectH", "circle"];
const REF_WIDTH = 1920;
const REF_HEIGHT = 1080;
const SQUARE_H_FACTOR = 1.0;
const RECT_H_FACTOR = 0.64;
const CIRCLE_H_FACTOR = 1.06;
const TRIANGLE_H_FACTOR = 0.92;

function preload() {
  oilTextureImg = loadImage("assets/oil-texture-reference.png");
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  frameRate(8);
  textFont("monospace");
  initializeTowers();
}

function draw() {
  renderScene();
}

function keyPressed() {
  const lower = key.toLowerCase();
  if (lower === "s") {
    addLayer();
  } else if (lower === "d") {
    addLayer();
  } else if (lower === "f") {
    addLayer();
  } else if (lower === "p") {
    saveCanvas("naive-babel-tower", "png");
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function initializeTowers() {
  towers.length = 0;
  for (let i = 0; i < TOWER_COUNT; i++) {
    const centerDistance = abs(i - (TOWER_COUNT - 1) * 0.5);
    const weightBoost = map(centerDistance, 0, (TOWER_COUNT - 1) * 0.5, 1.35, 0.9);
    towers.push({
      layers: [],
      xFactor: map(i, 0, TOWER_COUNT - 1, 0.16, 0.84),
      growthWeight: weightBoost
    });
  }
}

function addLayer() {
  const towerIndex = pickTowerIndex();
  if (towerIndex === -1) {
    return;
  }

  const targetTower = towers[towerIndex];
  const layerCount = targetTower.layers.length;
  const shouldForceTriangle = layerCount === AUTO_TRIANGLE_LAYER_INDEX;
  const shapeType = shouldForceTriangle ? "triangle" : random(RANDOM_LAYER_TYPES);
  const messageIndex = getTotalLayers() % layerMessages.length;
  const message = layerMessages[messageIndex];

  targetTower.layers.push({
    shapeType,
    message,
    colorHex: random(blockPalette),
    jitterX: 0,
    bubbleSide: random() < 0.5 ? "left" : "right",
    bubbleOffsetX: random(28, 72),
    bubbleOffsetY: random(-10, 10)
  });
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
}

function drawFrameAndPanel() {
  borderPad = 0;
  workX = 0;
  workY = 0;
  workW = width;
  workH = height;
  scaleFactor = min(workW / REF_WIDTH, workH / REF_HEIGHT);
  horizonY = workY + workH * 0.52;
  groundY = workY + workH - s(12);
  blockUnit = computeBlockUnitForTargetHeight();

  noStroke();
  fill(85, 25, 27, 238);
  rect(workX, workY, workW, workH);
}

function computeBlockUnitForTargetHeight() {
  const targetTopY = workY + workH * 0.2;
  const targetTowerHeight = max(80, groundY - targetTopY);
  const randomLayerCount = MAX_LAYERS - 1;
  const randomAvgHeightFactor = (SQUARE_H_FACTOR + RECT_H_FACTOR + CIRCLE_H_FACTOR) / 3;
  const totalHeightFactor =
    randomLayerCount * randomAvgHeightFactor +
    TRIANGLE_H_FACTOR +
    (MAX_LAYERS - 1) * GAP_RATIO;
  return targetTowerHeight / totalHeightFactor;
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
  text("Press S, D, or F to add a random square/rectangle/circle floor.", workX + s(16), workY + s(34));
  text(`Total layers: ${getTotalLayers()} / ${TOWER_COUNT * MAX_LAYERS}`, workX + s(16), workY + s(54));
}

function drawTower() {
  const scrambleOn = areAllTowersComplete();
  const flashOn = scrambleOn ? frameCount % 2 === 0 : false;

  for (const tower of towers) {
    let currentTop = groundY;
    const baseX = workX + workW * tower.xFactor;

    for (let i = 0; i < tower.layers.length; i++) {
      const layer = tower.layers[i];
      const dim = getLayerDimensions(layer.shapeType);
      const x = baseX + layer.jitterX - dim.w * 0.5;
      const y = currentTop - dim.h;
      const phrase = scrambleOn ? scrambleText(layer.message) : layer.message;

      drawBubblePhrase(
        tower.layers.length,
        i,
        x + dim.w * 0.5,
        y + dim.h * 0.5,
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

function getLayerDimensions(shapeType) {
  const base = blockUnit;
  if (shapeType === "square") {
    return { w: base * 1.2, h: base * SQUARE_H_FACTOR };
  }
  if (shapeType === "rectH") {
    return { w: base * 1.72, h: base * RECT_H_FACTOR };
  }
  if (shapeType === "circle") {
    return { w: base * 1.06, h: base * CIRCLE_H_FACTOR };
  }
  return { w: base * 1.14, h: base * TRIANGLE_H_FACTOR };
}

function getLayerGap() {
  return blockUnit * GAP_RATIO;
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
  } else if (shapeType === "circle") {
    fill(frontColor);
    ellipse(x + w * 0.5, y + h * 0.5, w, h);
    applyOilTextureToCircle(x, y, w, h);
    fill(255, 18);
    ellipse(x + w * 0.5, y + h * 0.5, w, h);
    drawPaintWear(x, y, w, h, false);
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

function applyOilTextureToCircle(x, y, w, h) {
  if (!oilTextureImg) {
    return;
  }

  const sx = random(max(1, oilTextureImg.width - 220));
  const sy = random(max(1, oilTextureImg.height - 220));
  const sw = min(220, oilTextureImg.width - sx);
  const sh = min(220, oilTextureImg.height - sy);

  const ctx = drawingContext;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x + w * 0.5, y + h * 0.5, w * 0.5, h * 0.5, 0, 0, TWO_PI);
  ctx.closePath();
  ctx.clip();

  blendMode(MULTIPLY);
  tint(255, 90);
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
  textValue,
  side,
  offsetX,
  offsetY,
  flashOn
) {
  const depthFromTop = towerLength - 1 - index;
  const alpha = map(depthFromTop, 0, FADE_DEPTH, 230, 18, true);
  const flashAlpha = flashOn ? alpha * 0.35 : alpha;
  const bubbleW = s(BOX_W);
  const bubbleH = s(BOX_H);
  const desiredY = blockCenterY + offsetY - bubbleH * 0.5;
  const bubbleY = constrain(desiredY, workY + s(8), workY + workH - bubbleH - s(8));
  const nearGap = s(14);
  const desiredX =
    side === "left"
      ? blockCenterX - bubbleW - nearGap - offsetX * 0.25
      : blockCenterX + nearGap + offsetX * 0.25;
  const bubbleX = constrain(desiredX, workX + s(8), workX + workW - bubbleW - s(8));

  noStroke();
  fill(245, 235, 220, flashAlpha);
  textSize(s(11));
  textAlign(CENTER, CENTER);
  text(textValue, bubbleX + bubbleW * 0.5, bubbleY + bubbleH * 0.5, bubbleW * 0.9, bubbleH);
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

