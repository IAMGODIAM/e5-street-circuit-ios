import assert from 'node:assert/strict';
import { packTick, quantSteer, rleDecode, rleEncode, unpackTick } from '../www/seatlog.js';

const ticks = [];
for (let i = 0; i < 12000; i++) {
  const q = quantSteer(Math.sin(i / 37));
  ticks.push(packTick(q, i % 90 < 70, i % 240 > 220, i % 600 > 580, false));
}

const encoded = rleEncode(ticks);
const decoded = rleDecode(encoded, 12000);
assert.deepEqual(decoded, ticks);
for (let i = 0; i < 100; i++) {
  const unpacked = unpackTick(ticks[i]);
  assert.ok(unpacked.steer >= -1 && unpacked.steer <= 1);
}
assert.equal(rleDecode([1, 12001], 12000), null);
assert.equal(rleDecode([9000, 1], 12000), null);
console.log(`seat log OK · ${ticks.length} ticks · ${encoded.length / 2} runs`);
