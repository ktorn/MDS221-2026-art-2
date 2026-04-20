let borderPad;
let workX;
let workY;
let workW;
let workH;
let horizonY;
let groundY;

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
const BASE_SIZE = 42;
const LAYER_GAP = 4;
const FADE_DEPTH = 8;
const TOWER_COUNT = 5;
const MAX_LAYERS = 8;
const AUTO_TRIANGLE_LAYER_INDEX = 7;

function setup() {
  createCanvas(windowWidth, windowHeight);
  noLoop();
  textFont("monospace");
  initializeTowers();
  redraw();
}

function draw() {
  renderScene();
}

function keyPressed() {
  const lower = key.toLowerCase();
  if (lower === "s") {
    addLayer("square");
  } else if (lower === "d") {
    addLayer("rectH");
  } else if (lower === "f") {
    addLayer("rectV");
  } else if (lower === "p") {
    saveCanvas("naive-babel-tower", "png");
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  redraw();
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

function addLayer(requestedShapeType) {
  const towerIndex = pickTowerIndex();
  if (towerIndex === -1) {
    return;
  }

  const targetTower = towers[towerIndex];
  const layerCount = targetTower.layers.length;
  const shouldForceTriangle = layerCount === AUTO_TRIANGLE_LAYER_INDEX;
  const shapeType = shouldForceTriangle ? "triangle" : requestedShapeType;
  const messageIndex = getTotalLayers() % layerMessages.length;
  const message = layerMessages[messageIndex];

  targetTower.layers.push({
    shapeType,
    message,
    colorHex: random(blockPalette),
    jitterX: random(-7, 7)
  });
  redraw();
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
  const panelRatio = 0.84;
  const panelW = min(width * panelRatio, height * panelRatio * 1.06);
  const panelH = panelW * 0.94;
  borderPad = max(14, panelW * 0.03);

  const frameX = (width - panelW) * 0.5;
  const frameY = (height - panelH) * 0.5;

  noStroke();
  fill(244, 244, 242);
  rect(frameX - borderPad, frameY - borderPad, panelW + borderPad * 2, panelH + borderPad * 2, 8);

  fill(235, 232, 220);
  rect(frameX, frameY, panelW, panelH);

  workX = frameX + borderPad;
  workY = frameY + borderPad;
  workW = panelW - borderPad * 2;
  workH = panelH - borderPad * 2;
  horizonY = workY + workH * 0.52;
  groundY = workY + workH - 12;

  noStroke();
  fill(85, 25, 27, 238);
  rect(workX, workY, workW, workH);
}

function drawBackgroundTexture() {
  noStroke();
  fill(255, 16);
  for (let i = 0; i < 1200; i++) {
    rect(random(workX, workX + workW), random(workY, workY + workH), random(0.6, 1.6), random(0.6, 1.6));
  }

  stroke(240, 210, 190, 32);
  strokeWeight(1);
  const stepY = workH / 9;
  for (let y = workY; y <= workY + workH; y += stepY) {
    line(workX, y, workX + workW, y);
  }

  noStroke();
  fill(180, 85, 36, 220);
  circle(workX + workW * 0.66, workY + workH * 0.2, workW * 0.13);
}

function drawInstruction() {
  noStroke();
  fill(242, 226, 200, 220);
  textSize(13);
  textAlign(LEFT, TOP);
  text("Build towers: S square, D horizontal, F vertical, P save", workX + 12, workY + 10);
  text("Random tower assignment (middle towers grow faster)", workX + 12, workY + 28);
  text(`Total layers: ${getTotalLayers()} / ${TOWER_COUNT * MAX_LAYERS}`, workX + 12, workY + 46);
}

function drawTower() {
  for (const tower of towers) {
    let currentTop = groundY;
    const baseX = workX + workW * tower.xFactor;
    const scrambleOn = tower.layers.length >= MAX_LAYERS;

    for (let i = 0; i < tower.layers.length; i++) {
      const layer = tower.layers[i];
      const dim = getLayerDimensions(layer.shapeType);
      const x = baseX + layer.jitterX - dim.w * 0.5;
      const y = currentTop - dim.h;
      const phrase = scrambleOn ? scrambleText(layer.message) : layer.message;

      drawPhrase(tower.layers.length, i, x + dim.w * 0.5, y + dim.h * 0.5, dim.w, phrase);
      drawBlock(x, y, dim.w, dim.h, layer.colorHex, layer.shapeType);

      currentTop = y - LAYER_GAP;
    }
  }
}

function getLayerDimensions(shapeType) {
  if (shapeType === "square") {
    return { w: BASE_SIZE, h: BASE_SIZE };
  }
  if (shapeType === "rectH") {
    return { w: BASE_SIZE * 1.5, h: BASE_SIZE * 0.62 };
  }
  if (shapeType === "rectV") {
    return { w: BASE_SIZE * 0.64, h: BASE_SIZE * 1.24 };
  }
  return { w: BASE_SIZE * 1.14, h: BASE_SIZE * 0.92 };
}

function drawBlock(x, y, w, h, colorHex, shapeType) {
  const frontColor = color(colorHex);
  const sideColor = lerpColor(frontColor, color("#211818"), 0.28);
  const topColor = lerpColor(frontColor, color("#f3d9a8"), 0.18);
  const depth = 8;
  const rise = 5;

  if (shapeType === "triangle") {
    noStroke();
    fill(frontColor);
    triangle(x, y + h, x + w * 0.5, y, x + w, y + h);

    fill(sideColor);
    triangle(x + w, y + h, x + w * 0.5, y, x + w + depth, y + h - rise);

    fill(topColor);
    triangle(x + w * 0.5, y, x + w * 0.5 + depth, y - rise, x + w, y + h);
  } else {
    noStroke();
    fill(frontColor);
    rect(x, y, w, h);

    fill(sideColor);
    quad(x + w, y, x + w + depth, y - rise, x + w + depth, y + h - rise, x + w, y + h);

    fill(topColor);
    quad(x, y, x + depth, y - rise, x + w + depth, y - rise, x + w, y);

    fill(255, 20);
    rect(x, y, w, h);
  }
}

function drawPhrase(towerLength, index, centerX, centerY, blockW, textValue) {
  const depthFromTop = towerLength - 1 - index;
  const alpha = map(depthFromTop, 0, FADE_DEPTH, 230, 18, true);

  noStroke();
  fill(245, 235, 220, alpha * 0.75);
  textSize(11);
  textAlign(CENTER, CENTER);
  text(textValue, centerX, centerY, min(BOX_W, blockW * 0.9), BOX_H);
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
