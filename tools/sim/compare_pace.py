#!/usr/bin/env python3
"""Compare a simulated lap (/tmp/claude-0/lap.json from tools/sim/hotlap.ts) with the real 2026 pole lap trace
(data/raw/telemetry/pole_trace.json, git-ignored). Prints min/max speeds at key points."""
import json, sys
import numpy as np
real = json.load(open('data/raw/telemetry/pole_trace.json'))
sim = json.load(open(sys.argv[1] if len(sys.argv) > 1 else '/tmp/claude-0/lap.json'))
d = np.array(real['dist']); v = np.array(real['speed']); thr = np.array(real['throttle'])
sd = np.array([x['lapDistance'] for x in sim]); sv = np.array([x['speedKmh'] for x in sim])
L = 6999.2; ctrl = 6882
pts = [(250,'T1 La Source','min'),(940,'Eau Rouge','min'),(1050,'Raidillon','min'),(2150,'end Kemmel','max'),(2300,'Les Combes','min'),
       (2550,'Malmedy','min'),(2930,'Rivage','min'),(3170,'T9','min'),(3800,'Pouhon','min'),(4450,'Fagnes','min'),(4830,'Campus','min'),
       (5050,'Stavelot','min'),(5650,'pre-Blanchimont','max'),(6040,'Blanchimont','min'),(6540,'pre-BusStop','max'),(6630,'Bus Stop','min')]
print(f"{'point':18s} {'real':>5s} {'sim':>5s}")
for s0, n, kind in pts:
    lapd = (s0 - ctrl) % L
    rm = np.abs(d - lapd) < 60; smm = np.abs(sd - lapd) < 60
    f = np.min if kind == 'min' else np.max
    rv = f(v[rm]) if rm.any() else float('nan'); svv = f(sv[smm]) if smm.any() else float('nan')
    print(f"{n:18s} {rv:5.0f} {svv:5.0f}")
print('real lap', real['lapTime'], 'full-throttle %', round(float((thr >= 99).mean() * 100), 1), 'vmax', v.max())
