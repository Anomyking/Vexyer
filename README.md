# Aetherworks — scroll-driven 3D portfolio

Cinematic, scroll-driven company site built with **Three.js + GSAP/ScrollTrigger** (Vite + TypeScript).
The 3D scenes were remodelled in Blender from your sketch scene (same layout and proportions).
Company name, projects and copy are **placeholders** — edit them in `index.html`.

```bash
npm install
npm run dev          # http://localhost:5173   (add ?debug for the perf HUD, ?quality=low|medium|high to force a tier)
npm test             # 32 tests: snapping, quality governor, timeline determinism
npm run build        # type-check + production build into dist/
```

## The journey (scroll progress 0 → 1)

| Progress | Beat |
|---|---|
| 0.00–0.14 | Hero: four slabs separate (staggered, depth offsets) over a glowing opening |
| 0.14–0.23 | Camera dives through the opening |
| 0.23–0.56 | Portfolio ring: sphere + 72 twisted block segments + 6 floating project screens; ring turns/translates with scroll, magnetic snap per project |
| 0.56–0.68 | Down through the cloud sea into blue sky |
| 0.68–0.80 | Two diagonal glass shards fly in on spline paths with synchronised HTML messages |
| 0.80–0.90 | Glass fragments + debris converge (damped springs) into 3 clickable elements |
| 0.90–1.00 | Paper plane crosses diagonally, grows into a full-screen wipe, camera hands over to a trailing chase view with speed streaks |

All timing lives in `src/core/chapters.ts`.

## Architecture

```
src/core/        engine (renderer, resize, context loss) · choreographer (one master timeline, scrubbed)
                 cameraRig · scroll (ScrollTrigger + damping) · quality (tiers + frame-time governor) · chapters
src/scenes/      hero · portfolio · atmosphere (clouds) · glass · plane · lighting   (each is a SceneModule)
src/effects/     glass / cloud / streak / sky shaders · postfx (speed blur) · previews
src/interaction/ snap (pure logic) · portfolioInput · fragments (real <button>s over projected positions)
src/ui/          overlays (HTML ↔ progress) · panel (accessible dialog) · hud
src/assets/      loader (GLB + Meshopt + KTX2, progressive) · procedural (mirrors the Blender models)
```

Key design decisions
- **The timeline is scrubbed, never played.** Every visual state is a pure function of progress, so scrolling backward, jumping via the nav, or rebuilding the timeline mid-scroll all give identical frames (verified in `tests/choreography.test.ts`).
- **Native scrolling is kept** (touch inertia, keyboard, scrollbar); the scene shows a *damped* copy of progress.
- **Magnetic snap** (`src/interaction/snap.ts`): velocity-aware (a flick throws to the next project), never fights a held finger, and **only acts between the first and last project** — before/after, scrolling is free, so users can't get trapped. Arrow keys, on-screen arrows and horizontal swipes step between projects.
- **All text is semantic HTML.** Without WebGL (or on error) the page switches to a normal stacked layout with every project and panel text visible.
- **Glass = one cheap shader** (Fresnel + procedural sky reflection + edge glow). No transmission pass, no refraction buffer.
- **Clouds = instanced soft-shaded puffs** (one draw call). Ring = one `InstancedMesh`.
- **Performance:** adaptive tiers (`high/medium/low`) from device capability, then a runtime governor (resolution first, then tier, with hysteresis so it doesn't oscillate), pixel-ratio cap, rendering paused when the tab is hidden, geometry/material/texture disposal, lazy per-chapter loading, low-poly `_lo` meshes on weak devices.
- **Reduced motion** (system setting + header toggle): camera travel becomes short moves between still "anchor" frames, particles/post-fx are off.

## Assets

`public/models/{hero,portfolio,sky,glass,plane}.glb` are Meshopt-compressed (~49 KB total).
**They are not in this zip** (they live on your machine at `Videos/blender/portfolio_assets/`; copy them into `public/models/`). Until you do, the site builds identical geometry in code, so it always runs.

Regenerate from Blender (builds in a temporary scene, does not touch yours):
```bash
blender -b -P blender/export_assets.py -- public/models
```
> The geometry and export settings in this script are the ones that produced your exported GLBs in Blender 5.2.1. The final tweak that makes it headless-safe (a `temp_override` context instead of switching the window's scene) could not be run before packaging, so if `blender -b` errors, run it from the Scripting tab instead and tell me.
Optional KTX2 project previews: put `public/previews/project-1.ktx2 … project-6.ktx2` (Basis transcoder is bundled); otherwise abstract UI mocks are painted at runtime.

## Not verified yet — please test on real devices

This was built and tested in a headless environment with **no GPU/browser**, so the following are untested: visual look and camera framing, real frame rates, shader compile on mobile GPUs, touch feel. Type-check, build and the 32 logic tests pass. Suggested first pass: open with `?debug`, scroll through once on desktop, then on a mid/low-end phone, and tune `src/core/chapters.ts` (timing), `src/core/cameraRig.ts` (framing) and `TIERS` in `src/core/quality.ts`.
