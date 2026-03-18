const WHEEL_RADIUS_M = 0.34;
const WHEEL_CIRCUMFERENCE_M = 2 * Math.PI * WHEEL_RADIUS_M;

const GEARBOX_LIBRARY = {
  offroad4: { name: 'Offroad 4', gearRatios: [3.90, 2.30, 1.52, 1.00], reverseRatio: 3.40 },
  touring5: { name: 'Touring 5', gearRatios: [3.55, 2.18, 1.52, 1.16, 0.90], reverseRatio: 3.20 },
  sport6: { name: 'Sport 6', gearRatios: [3.30, 2.18, 1.62, 1.28, 1.04, 0.86], reverseRatio: 3.05 },
  race7: { name: 'Race 7', gearRatios: [3.20, 2.25, 1.72, 1.40, 1.15, 0.97, 0.84], reverseRatio: 2.95 },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function inferGripValue(carData) {
  if (carData?.stats && Number.isFinite(carData.stats.h)) return carData.stats.h;
  if (Number.isFinite(carData?.hdl)) return Math.round(clamp(carData.hdl * 100, 35, 100));
  return 70;
}

function pickTemplate(maxSpeedMs, redlineRpm) {
  const maxKph = maxSpeedMs * 3.6;
  if (maxKph >= 280 || redlineRpm > 8600) return GEARBOX_LIBRARY.race7;
  if (maxKph >= 220) return GEARBOX_LIBRARY.sport6;
  if (maxKph <= 185) return GEARBOX_LIBRARY.offroad4;
  return GEARBOX_LIBRARY.touring5;
}

function calcFinalDrive(maxSpeedMs, topGearRatio, redlineRpm) {
  const wheelRpmAtTop = (maxSpeedMs / WHEEL_CIRCUMFERENCE_M) * 60;
  if (wheelRpmAtTop <= 0) return 3.4;
  const targetTopRpm = redlineRpm * 0.98;
  const rawFinalDrive = targetTopRpm / (wheelRpmAtTop * topGearRatio);
  return clamp(rawFinalDrive, 2.2, 5.6);
}

export function buildGearboxForCar(carData) {
  const grip = inferGripValue(carData);
  const redlineRpm = clamp(Math.round(grip * 100), 4500, 9800);
  const idleRpm = clamp(Math.round(redlineRpm * 0.10), 700, 1100);

  const template = pickTemplate(carData.maxSpd || 40, redlineRpm);
  const topGearRatio = template.gearRatios[template.gearRatios.length - 1];
  const finalDrive = calcFinalDrive(carData.maxSpd || 40, topGearRatio, redlineRpm);

  const upshiftRpm = Math.round(redlineRpm * 0.96);
  const downshiftRpm = Math.max(idleRpm + 550, Math.round(redlineRpm * 0.52));

  return {
    name: template.name,
    wheelCircumference: WHEEL_CIRCUMFERENCE_M,
    gearRatios: template.gearRatios,
    reverseRatio: template.reverseRatio,
    finalDrive,
    idleRpm,
    redlineRpm,
    upshiftRpm,
    downshiftRpm,
  };
}

export function rpmFromSpeed(speedMs, gearbox, gearIndex) {
  const ratio = gearbox?.gearRatios?.[gearIndex - 1];
  if (!ratio || !gearbox?.wheelCircumference) return gearbox?.idleRpm || 800;
  const wheelRpm = (Math.max(0, speedMs) / gearbox.wheelCircumference) * 60;
  const engRpm = wheelRpm * ratio * gearbox.finalDrive;
  return Math.max(gearbox.idleRpm, Math.min(gearbox.redlineRpm, engRpm));
}
