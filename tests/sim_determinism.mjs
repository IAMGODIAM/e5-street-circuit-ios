import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSim, SIM_VERSION } from '../www/sim.js';

const pack = JSON.parse(await readFile(new URL('../www/packs/olive_drive.json', import.meta.url), 'utf8'));
const options = { pack, mode: 'roam', seed: 20260827, car: 'sovereign', steer: 'manual', traffic: 8, rivals: 0 };
const left = createSim(options);
const right = createSim(options);

for (let tick = 0; tick < 5000; tick++) {
  const phase = tick % 720;
  const input = {
    th: phase < 520 ? 1 : 0,
    br: phase >= 520 && phase < 600 ? 1 : 0,
    hb: phase >= 600 && phase < 620 ? 1 : 0,
    reset: 0,
    steer: Math.round(Math.sin(tick / 83) * 128) / 128,
  };
  left.step(input);
  right.step(input);
  assert.equal(left.hash(), right.hash(), `simulation divergence at tick ${tick}`);
}

assert.equal(left.hash(), right.hash());
console.log(`determinism OK · street-${SIM_VERSION} · tick ${left.tick} · hash ${left.hash()}`);
