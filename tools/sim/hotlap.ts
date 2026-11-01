/** Headless hot lap: `npx tsx tools/sim/hotlap.ts [compound] [--centerline]` prints a lap summary. */
import { readFileSync, writeFileSync } from 'node:fs';
import { CAR_2026, makeEnv } from '../../src/physics/data';
import { runHotLap } from '../../src/sim/lapRunner';
import { TrackModel } from '../../src/track/TrackModel';
import type { TrackData } from '../../src/track/types';

const data = JSON.parse(readFileSync('data/track/spa-2026.json', 'utf8')) as TrackData;
const bin = readFileSync('data/track/terrain.bin');
const track = new TrackModel(data, new Float32Array(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength)));
const args = process.argv.slice(2);
const t0 = Date.now();
const r = runHotLap(CAR_2026, makeEnv(track), { compound: args[0] && !args[0].startsWith('--') ? args[0] : 'soft', centerline: args.includes('--centerline') });
const fmt = (x: number | null) => (x === null ? 'DNF' : `${Math.floor(x / 60)}:${(x % 60).toFixed(3).padStart(6, '0')}`);
console.log(`lap ${fmt(r.lapTime)}  sectors ${r.sectorTimes.map((x) => x.toFixed(2)).join(' / ')}  profile ${fmt(r.profileLapTime)}`);
console.log(`vmax ${r.maxSpeedKmh.toFixed(1)} km/h  maxWheelsOut ${r.maxWheelsOutside}  fullyOut ${r.timeFullyOutside.toFixed(2)} s  impacts ${r.impacts}  fuel ${r.fuelUsedKg.toFixed(2)} kg  wall ${Date.now() - t0} ms`);
const pick = (from: number, to: number) => r.samples.filter((s) => s.lapDistance >= from && s.lapDistance < to);
for (const [name, a, b] of [['Kemmel', 1200 + 118, 2150 + 118], ['Blanchimont-BusStop', 5600 + 118, 6600 + 118]] as const) {
  const seg = pick(a, b);
  console.log(name, seg.filter((_, i) => i % 6 === 0).map((s) => `${s.speedKmh.toFixed(0)}k/${s.electricKw.toFixed(0)}kW/soc${(s.soc * 100).toFixed(0)}${s.derating ? 'D' : ''}${s.superclip ? 'S' : ''}`).join(' '));
}
writeFileSync('/tmp/claude-0/lap.json', JSON.stringify(r.samples));
// energy summary over the timed lap (integrate electrical power from the 10 m samples)
let dep = 0;
let har = 0;
for (let i = 1; i < r.samples.length; i++) {
  const a = r.samples[i - 1]!;
  const b = r.samples[i]!;
  const dt = b.t - a.t;
  if (dt <= 0) continue;
  if (a.electricKw > 0) dep += a.electricKw * dt;
  else har -= a.electricKw * dt;
}
const brakeT = r.samples.reduce((acc, s, i) => acc + (i > 0 && s.brake > 0.05 ? s.t - r.samples[i - 1]!.t : 0), 0);
console.log(`deploy ${(dep / 1000).toFixed(2)} MJ  harvest(crank) ${(har / 1000).toFixed(2)} MJ  braking time ${brakeT.toFixed(1)} s`);
