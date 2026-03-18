'use strict';
import { state, dc, dctx, mmctx, keys } from './state.js';
import { fmtT } from './utils/format.js';
import { getGyroVisualSteer } from './touch-controls.js';

const HUD_ELEMENTS = {
  speed: document.getElementById('speedNum'),
  gear: document.getElementById('gearNum'),
  lap: document.getElementById('lapVal'),
  checkpoints: document.getElementById('cpVal'),
  timer: document.getElementById('timer'),
  lapTimes: document.getElementById('lapTimes'),
  position: document.getElementById('posNum'),
};

const MINIMAP_SIZE = { width: 150, height: 150 };
const ORDINAL_SUFFIXES = ['TH', 'ST', 'ND', 'RD'];

function getOrdinalSuffix(position) {
  return position >= 1 && position <= 3 ? ORDINAL_SUFFIXES[position] : ORDINAL_SUFFIXES[0];
}

function getPlayerSpeedKph() {
  const speed = state.pCar.isReversing ? state.pCar.revSpd : state.pCar.spd;
  return Math.round(speed * 3.6);
}

function updateHudTelemetry() {
  HUD_ELEMENTS.speed.textContent = getPlayerSpeedKph();
  HUD_ELEMENTS.gear.textContent = state.pCar.gear === 0 ? 'R' : state.pCar.gear;
  HUD_ELEMENTS.lap.textContent = `${Math.min(state.pCar.lap + 1, state.trkData.laps)} / ${state.trkData.laps}`;
  HUD_ELEMENTS.checkpoints.textContent = `${state.pCar.cpPassed} / ${state.trkData.wp.length}`;
  HUD_ELEMENTS.timer.textContent = fmtT(state.raceTime);
}

function updateHudLapTimes() {
  if (!state.pCar.lapTimes?.length) {
    HUD_ELEMENTS.lapTimes.textContent = '';
    return;
  }

  HUD_ELEMENTS.lapTimes.innerHTML = state.pCar.lapTimes
    .map((time, index) => `L${index + 1} ${fmtT(time)}`)
    .join('<br>');
}

function updateHudPosition() {
  const ranking = [state.pCar, ...state.aiCars].sort((a, b) => b.totalProg - a.totalProg);
  const playerPosition = ranking.indexOf(state.pCar) + 1;
  HUD_ELEMENTS.position.innerHTML = `${playerPosition}<sup style="font-size:18px">${getOrdinalSuffix(playerPosition)}</sup>`;
}

export function updateHUD() {
  if (!state.pCar || !state.trkData || (state.gState !== 'racing' && state.gState !== 'finished')) {
    return;
  }

  updateHudTelemetry();
  updateHudLapTimes();
  updateHudPosition();
}

export function resizeDC() {
  dc.width = window.innerWidth;
  dc.height = window.innerHeight;
}

function drawDashBackground(ctx, width, panelY, panelHeight) {
  const gradient = ctx.createLinearGradient(0, panelY, 0, panelY + panelHeight);
  gradient.addColorStop(0, 'rgba(8,8,18,.94)');
  gradient.addColorStop(1, 'rgba(2,2,6,.98)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, panelY, width, panelHeight);
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, panelY, width, 2);
}

function getVisualSteer() {
  const gyroVisual = getGyroVisualSteer();
  const keySteer = (keys.ArrowLeft || keys.KeyA) ? -1 : (keys.ArrowRight || keys.KeyD) ? 1 : 0;
  return (Math.abs(gyroVisual) > 0.01 ? gyroVisual : keySteer) * 0.35;
}

function drawSteeringWheel(ctx, width, height, panelHeight) {
  const wheelRadius = panelHeight * 0.66;
  const centerX = width / 2;
  const centerY = height - panelHeight * 0.07;

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(getVisualSteer());
  ctx.beginPath(); ctx.arc(0, 0, wheelRadius, 0, Math.PI * 2); ctx.strokeStyle = '#1e1e2e'; ctx.lineWidth = wheelRadius * 0.22; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, wheelRadius, 0, Math.PI * 2); ctx.strokeStyle = '#2a2a3e'; ctx.lineWidth = wheelRadius * 0.14; ctx.stroke();

  for (const angle of [0, 2.094, 4.189]) {
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * wheelRadius * 0.14, Math.sin(angle) * wheelRadius * 0.14);
    ctx.lineTo(Math.cos(angle) * wheelRadius * 0.82, Math.sin(angle) * wheelRadius * 0.82);
    ctx.strokeStyle = '#1c1c2c';
    ctx.lineWidth = wheelRadius * 0.13;
    ctx.stroke();
    ctx.strokeStyle = '#323248';
    ctx.lineWidth = wheelRadius * 0.07;
    ctx.stroke();
  }

  ctx.beginPath(); ctx.arc(0, 0, wheelRadius * 0.16, 0, Math.PI * 2); ctx.fillStyle = '#12121e'; ctx.fill(); ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#ff5500';
  ctx.font = `bold ${wheelRadius * 0.16}px Orbitron,monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TR', 0, 0);
  ctx.restore();
}

function drawGearDisplay(ctx, width, panelY, panelHeight) {
  ctx.font = `bold ${panelHeight * 0.52}px Orbitron,monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffd700';
  ctx.shadowColor = 'rgba(255,215,0,.5)';
  ctx.shadowBlur = 22;
  ctx.fillText(state.pCar.gear === 0 ? 'R' : state.pCar.gear, width / 2, panelY + panelHeight * 0.52);
  ctx.shadowBlur = 0;
  ctx.font = `${panelHeight * 0.11}px Rajdhani,sans-serif`;
  ctx.fillStyle = '#334';
  ctx.fillText('GEAR', width / 2, panelY + panelHeight * 0.8);
}

function drawRevBar(ctx, width, panelY, panelHeight) {
  const barWidth = width * 0.32;
  const barHeight = panelHeight * 0.055;
  const barX = (width - barWidth) / 2;
  const barY = panelY + panelHeight * 0.12;
  const redline = state.pCar.redlineRpm || 8000;
  const warnRpm = state.pCar.shiftWarnRpm || Math.round(redline * 0.78);
  const currentFraction = state.pCar.rpm / redline;
  const warningFraction = warnRpm / redline;

  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(barX, barY, barWidth, barHeight);

  for (let index = 0; index < 20; index += 1) {
    const fraction = (index + 1) / 20;
    if (fraction > currentFraction) continue;

    ctx.fillStyle = fraction < warningFraction * 0.7 ? '#00aa44' : fraction < warningFraction ? '#aaaa00' : '#ff2200';
    ctx.fillRect(barX + (index / 20) * barWidth + 2, barY + 2, barWidth / 20 - 3, barHeight - 4);
  }
}

export function drawDash() {
  if (state.camMode !== 'cockpit' || !state.pCar) return;

  const width = dc.width;
  const height = dc.height;
  const panelHeight = height * 0.3;
  const panelY = height - panelHeight;

  dctx.clearRect(0, 0, width, height);
  drawDashBackground(dctx, width, panelY, panelHeight);
  drawSteeringWheel(dctx, width, height, panelHeight);

  const gaugeRadius = Math.min(width * 0.12, panelHeight * 0.42);
  const redline = state.pCar.redlineRpm || 8000;
  const warnRpm = state.pCar.shiftWarnRpm || Math.round(redline * 0.78);
  drawGauge(dctx, width * 0.2, panelY + panelHeight * 0.5, gaugeRadius, state.pCar.rpm, 0, redline, warnRpm, '#ff3300', 'RPM', (value) => `${(value / 1000).toFixed(1)}k`);

  const maxKph = Math.round(state.pCar.data.maxSpd * 3.6 * 1.08);
  drawGauge(dctx, width * 0.8, panelY + panelHeight * 0.5, gaugeRadius, state.pCar.spd * 3.6, 0, maxKph, maxKph * 0.82, '#ffaa00', 'KM/H', (value) => Math.round(value));

  drawGearDisplay(dctx, width, panelY, panelHeight);
  drawRevBar(dctx, width, panelY, panelHeight);
}

export function drawGauge(ctx, cx, cy, radius, value, minValue, maxValue, warningValue, warningColor, label, formatter) {
  const startAngle = Math.PI * 0.75;
  const endAngle = Math.PI * 2.25;
  const range = endAngle - startAngle;
  const valueFraction = Math.max(0, Math.min(1, (value - minValue) / (maxValue - minValue)));
  const valueAngle = startAngle + valueFraction * range;
  const warningAngle = startAngle + ((warningValue - minValue) / (maxValue - minValue)) * range;

  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fillStyle = '#090912'; ctx.fill();
  ctx.strokeStyle = '#1a1a2a'; ctx.lineWidth = radius * 0.06; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, radius * 0.82, startAngle, endAngle); ctx.strokeStyle = '#111120'; ctx.lineWidth = radius * 0.18; ctx.stroke();

  if (valueFraction > 0) {
    const normalEnd = Math.min(valueAngle, warningAngle);
    if (normalEnd > startAngle) {
      ctx.beginPath(); ctx.arc(cx, cy, radius * 0.82, startAngle, normalEnd); ctx.strokeStyle = '#00cc55'; ctx.lineWidth = radius * 0.18; ctx.stroke();
    }
    if (valueAngle > warningAngle) {
      ctx.beginPath(); ctx.arc(cx, cy, radius * 0.82, warningAngle, valueAngle); ctx.strokeStyle = warningColor; ctx.lineWidth = radius * 0.18; ctx.stroke();
    }
  }

  for (let index = 0; index <= 10; index += 1) {
    const angle = startAngle + (index / 10) * range;
    const majorTick = index % 2 === 0;
    const innerRadius = radius * (majorTick ? 0.59 : 0.67);
    const outerRadius = radius * 0.73;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * innerRadius, cy + Math.sin(angle) * innerRadius);
    ctx.lineTo(cx + Math.cos(angle) * outerRadius, cy + Math.sin(angle) * outerRadius);
    ctx.strokeStyle = majorTick ? '#666' : '#333';
    ctx.lineWidth = majorTick ? 2 : 1;
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(valueAngle);
  ctx.beginPath(); ctx.moveTo(-radius * 0.07, 0); ctx.lineTo(radius * 0.70, 0); ctx.strokeStyle = '#ff6622'; ctx.lineWidth = radius * 0.04; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, radius * 0.08, 0, Math.PI * 2); ctx.fillStyle = '#222'; ctx.fill();
  ctx.restore();

  ctx.font = `bold ${radius * 0.28}px Orbitron,monospace`;
  ctx.fillStyle = '#ddd';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(formatter(value), cx, cy + radius * 0.14);
  ctx.font = `${radius * 0.17}px Rajdhani,sans-serif`;
  ctx.fillStyle = '#444466';
  ctx.fillText(label, cx, cy + radius * 0.46);
}

function getMinimapTransform() {
  const { width, height } = MINIMAP_SIZE;
  let maxX = -Infinity;
  let minX = Infinity;
  let maxZ = -Infinity;
  let minZ = Infinity;

  for (const point of state.trkPts) {
    if (point.x > maxX) maxX = point.x;
    if (point.x < minX) minX = point.x;
    if (point.z > maxZ) maxZ = point.z;
    if (point.z < minZ) minZ = point.z;
  }

  const scale = Math.min(width / (maxX - minX + 24), height / (maxZ - minZ + 24)) * 0.88;
  const offsetX = width / 2 - (minX + (maxX - minX) / 2) * scale;
  const offsetZ = height / 2 - (minZ + (maxZ - minZ) / 2) * scale;

  return {
    toCanvas(x, z) {
      return [x * scale + offsetX, z * scale + offsetZ];
    },
  };
}

function drawMinimapTrack(transform) {
  const { width, height } = MINIMAP_SIZE;
  mmctx.clearRect(0, 0, width, height);
  mmctx.fillStyle = 'rgba(0,0,0,.72)';
  mmctx.fillRect(0, 0, width, height);
  mmctx.beginPath();

  const [startX, startZ] = transform.toCanvas(state.trkPts[0].x, state.trkPts[0].z);
  mmctx.moveTo(startX, startZ);
  for (const point of state.trkPts) {
    const [canvasX, canvasZ] = transform.toCanvas(point.x, point.z);
    mmctx.lineTo(canvasX, canvasZ);
  }
  mmctx.closePath();
  mmctx.strokeStyle = 'rgba(255,255,255,.25)';
  mmctx.lineWidth = 5;
  mmctx.stroke();
  mmctx.strokeStyle = '#1a1a2e';
  mmctx.lineWidth = 2;
  mmctx.stroke();
}

export function updateMinimapCars(transform) {
  for (const car of state.aiCars) {
    const [x, z] = transform.toCanvas(car.pos.x, car.pos.z);
    mmctx.beginPath();
    mmctx.arc(x, z, 3.5, 0, Math.PI * 2);
    mmctx.fillStyle = `#${car.data.col.toString(16).padStart(6, '0')}`;
    mmctx.fill();
  }
}

export function updateMinimapPlayer(transform) {
  const [x, z] = transform.toCanvas(state.pCar.pos.x, state.pCar.pos.z);
  mmctx.beginPath();
  mmctx.arc(x, z, 5.5, 0, Math.PI * 2);
  mmctx.fillStyle = '#ffd700';
  mmctx.fill();
  mmctx.strokeStyle = '#fff';
  mmctx.lineWidth = 1.5;
  mmctx.stroke();
}

export function drawMinimap() {
  if (!state.trkPts.length || !state.pCar) return;

  const transform = getMinimapTransform();
  drawMinimapTrack(transform);
  updateMinimapCars(transform);
  updateMinimapPlayer(transform);
}
