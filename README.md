# NEON-DASH
A premium 3D endless runner for the desktop browser. Control a glowing futuristic cube speeding down a neon track in a dark cyberpunk city — dodge red blocks, leap over barriers and gaps, collect gold coins, and survive as the world speeds up.

🎮 How to Run
Option 1 — Single file (easiest) Double-click NEON-DASH.html. It runs directly in any modern desktop browser.

Option 2 — Developer version (separate files) Open index.html, or serve the folder locally:

cd neon-dash
python3 -m http.server 8000
# then visit http://localhost:8000
An internet connection is required on first load — Three.js and the fonts are loaded from a CDN. No build step, no backend, no install.

⌨️ Controls
Key	Action
SPACE / W / ↑	Jump (also: click the canvas)
A / D or ← / →	Switch lane
P / ESC	Pause / resume
SPACE / ENTER	Start (from menu & game over)
The tab also auto-pauses if you switch away from it.

🕹️ Gameplay
The cube runs forward automatically; the speed keeps increasing.
Red blocks — change lanes to dodge them (they can't be jumped).
Orange barriers — low, jump over them.
Gaps in the track — marked with red warning strips; jump or fall into the void.
Gold coins — collect them for +20 points each; coin arcs show you where to jump.
Score = distance survived + coins × 20.
Your best score is saved automatically in the browser (localStorage).
✨ Features
Endless procedurally generated track (3 lanes, 12 recycling segments)
Three hazard types + guaranteed-passable pattern generation
Increasing difficulty: speed ramps from x1.0 up to x2.5
Neon visual style: reflective metallic track, glowing rails, arches, starfield, distant skyline and a portal ring on the horizon
Bloom post-processing, camera shake, FOV that widens with speed, squash-and-stretch cube animation, trail particles, coin bursts and explosions
Synthesized retro sound effects (jump, coin, lane switch, crash) — no audio files
Animated home screen with attract-mode background, How-to-Play section, pause menu, and a game-over screen with score count-up and NEW BEST badge
Performance-minded: pooled particles, merged skyline geometry, half-resolution bloom, capped pixel ratio, throttled HUD updates
🗂️ Files
File	Purpose
NEON-DASH.html	The whole game in one self-contained file
index.html	Page structure and UI overlays (dev version)
styles.css	Neon UI styling and screen transitions
game.js	Three.js engine: track, physics, FX, UI wiring
🛠️ Tech
Three.js r160 (via CDN import map) — WebGL rendering
EffectComposer + UnrealBloomPass for the neon glow
Web Audio API for synthesized sound effects
Pure HTML/CSS for the UI layer
🩺 Troubleshooting
Black screen — check that the browser is up to date (WebGL 2 required).
Best score missing — localStorage is per-origin; scores don't transfer between file:// and a local server.
No sound — browsers only enable audio after your first click or key press.
Have a good run — and don't look at the gap too long. 🟦⚡
