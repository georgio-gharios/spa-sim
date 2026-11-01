# Manual hardware checklist

Automated tests cover every device type with mocked Gamepad API devices (`tests/input-*.test.ts`,
`e2e/input.spec.ts`). Real hardware can only be checked by the owner. Run `npm run dev`, open the URL in
**Firefox** (your main browser) and, where noted, also in Chrome/Edge. Note pass/fail and anything odd
next to each line and paste it back.

Open the controls menu with **Esc** (keyboard) or **Options / Menu** (pads). The menu pauses the car,
shows live steer/throttle/brake meters and saves every change in this browser.

## Phase 3: input (`v0.3-input`)

### Keyboard
- [ ] W/S, A/D and the arrows drive; E/Q shift (Pro assists, H); X, O, P, R, V work as shown in the HUD hint.
- [ ] Controls → Keyboard → "+ Bind" on Throttle → press I → I accelerates. Reload the page: still bound.
- [ ] Keyboard smoothing sliders change the feel (e.g. Steer speed 4/s feels sharper). Reset → back to defaults.

### DualShock 4 / DualSense / Xbox (each one you own; USB and Bluetooth if possible)
- [ ] Plugging the pad in shows "… connected" at the top, with the right name (DualShock 4 / DualSense / Xbox controller).
- [ ] The HUD hint switches to that pad's glyphs once you touch it (✕ ○ □ △ / L2 R2, or A B X Y / LT RT).
- [ ] R2/RT throttle and L2/LT brake are analogue (watch the HUD pedal bars); left stick steers.
- [ ] ✕/A shift up, □/X shift down (Pro), △/Y straight mode, ○/B overtake, d-pad → pit limiter, d-pad ← assists, R1/RB camera, Share/View reset, Options/Menu opens the menu.
- [ ] Deadzone 0 → the car drifts at rest if the stick does; 0.08 (default) → it doesn't. Linearity 2 → finer small steering.
- [ ] Rebind throttle to ✕/A, reload, still bound; "Reset … to defaults" restores R2/RT.
- [ ] Unplug mid-lap: "… disconnected" toast and the car coasts (no stuck throttle). Plug back in: works again without reloading.
- [ ] **Rumble (Chrome/Edge only):** kerbs buzz, locking the brakes and wheelspin in 1st/2nd rumble, grass rumbles, hitting a barrier kicks. Strength slider and Enabled toggle work.
- [ ] Firefox: the Rumble box says the browser has no vibration API (expected).
- [ ] If the DualShock 4 / DualSense acts strangely in Firefox (wrong buttons, triggers stuck at half): note which browser/OS/connection. The raw-layout remap is best-knowledge (`src/input/devices.ts`).

### Steering wheel (if you have one)
- [ ] Plugging it in shows "… connected · check pedal axes in Controls (Esc)".
- [ ] Controls → Wheel: turn the wheel and press each pedal; the live meters follow. If throttle/brake don't move, "+ Bind" on Throttle and press the pedal (repeat for Brake). The pedal replaces the default axis.
- [ ] Set the wheel's own software rotation to 360° and set both rotation sliders to 360° → the on-screen wheel turns 1:1 with yours.
- [ ] Paddles shift (or rebind them). No force feedback (browsers have no FFB API).
- [ ] Note the wheel model and the axis numbers it used, so the defaults can be improved.

### Every device
- [ ] Complete a full lap with it (any pace) without the input dropping out.
