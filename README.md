# Aetherworks — scroll-driven 3D portfolio

Cinematic, scroll-driven company site built with **Three.js + GSAP/ScrollTrigger** (Vite + TypeScript).
The 3D scenes were remodelled in Blender from your sketch scene (same layout and proportions).
Company name, projects and copy are **placeholders** — edit them in `index.html`.

```bash
npm install
npm run dev          # http://localhost:5173   (add ?debug for the perf HUD, ?quality=low|medium|high to force a tier)
npm test             # 70 tests: snapping, quality governor, timeline determinism, hero coverage, cloud layout, normals
npm run build        # type-check + production build into dist/
```

## The journey (scroll progress 0 → 1)

| Progress | Beat |
|---|---|
| 0.00–0.14 | Hero: four large overlapping slabs cover the whole screen, then peel apart (top layer first, each to its own corner) revealing a glowing opening |
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
- **Hero slabs are sized from the camera frustum** (`src/scenes/heroLayout.ts`, pure + ray-cast tested on 8 aspect ratios), so they cover every screen shape and are rebuilt on resize.
- **Polish pass on the studio glass**: bevelled crystals (`bevel` in `facets.ts`, a Minkowski sum with a tiny icosahedron), faint internal fracture plates, a floor at `FLOOR_Y` (`src/effects/stageFloor.ts`) with dim mirrored copies of the fragments as reflections, and a bloom pass (`src/effects/postfx.ts`, driven by `sky.stage`, threshold 1.05 so only HDR-bright edges and beams glow). The post pass now also applies tone mapping and colour encoding like a direct render, so the final flight's speed blur matches the rest of the scene.
- **Studio stage**: `sky.stage` (tweened 0.772-0.935 in `cameraRig.ts`) fades the sky to a dark crimson room with tall light beams and a glossy horizon, and fades the clouds out. Colours live in the `uStage` block of `src/effects/skydome.ts` and `stageColor()` in `src/effects/glass.ts`.
- **Sky = one dithered dome shader** (atmosphere, Mie sun glow, fbm clouds above, a cloud deck below) plus shader-shaped billboard cloud puffs; the sun direction is shared with the glass so highlights agree.
- **Glass = one cheap shader on angular crystals**: convex-hull crystals with flat facets (`src/effects/facets.ts`), a barycentric edge pass for sharp lit facet edges, Schlick Fresnel, faked refraction with slight dispersion, per-facet key light and glints, double-sided so back edges show through. `uStage` swaps its environment from daylight to the crimson stage. Glass is generated in code only (the exported glass GLB is not used). On the **high** tier the three fragments also get a real `MeshPhysicalMaterial` body (transmission, thickness-based red absorption, IOR 1.6, dispersion, clearcoat) lit by a baked studio environment (`src/effects/stageEnv.ts`); the shader mesh then draws only the sharp facet edges on top. Medium/low keep the cheap shader-only look (no transmission pass), and any setup failure falls back to it automatically.
- **Clouds = instanced soft-shaded puffs** (one draw call). Ring = one `InstancedMesh`.
- **Performance:** adaptive tiers (`high/medium/low`) from device capability, then a runtime governor (resolution first, then tier, with hysteresis so it doesn't oscillate), pixel-ratio cap, rendering paused when the tab is hidden, geometry/material/texture disposal, lazy per-chapter loading, low-poly `_lo` meshes on weak devices.
- **Reduced motion** (system setting + header toggle): camera travel becomes short moves between still "anchor" frames, particles/post-fx are off.

## Paper plane steering

During the final chase the plane follows the mouse (`PlaneModule` in `src/scenes/plane.ts`): it slides across the chase camera's view toward the pointer (spring-smoothed, up to about 5 units sideways and 2.5 up), banks into the turn from its sideways velocity, and yaws and pitches slightly toward where it is heading. It fades in over the first moments of the chase, is off with reduced motion and for touch, and with a centred pointer it flies the original line. The scripted camera is unchanged, so scrubbing stays deterministic.

## Loading screen

The loader is inline in `index.html` (critical CSS in `<head>`), so it paints before any stylesheet or script and the page content stays hidden behind it (no flash of unstyled HTML). `src/main.ts` loads every scene module, waits for fonts and the page `load` event, renders two frames, then wipes it away (`finishLoading()`). A 25 s timer in `main.ts` and a 30 s inline script in `index.html` guarantee nobody is stuck behind it. Without JavaScript the class that hides the page is never added, so the plain page shows as normal. With reduced motion it fades instead of wiping.

## Text on the glass

`src/effects/glassLabel.ts` draws serif text to a transparent canvas (`CanvasTexture`) shown on a plane that is a child of each fragment's rig group in `src/scenes/glass.ts`. Edit the copy in `FRAGMENT_LABELS`, or call `glass.setLabel(i, { title, body, meta })` to redraw at runtime. Tunables at the top of `glass.ts`: `FRAG_SCALES`, `LABEL_WIDTH_K`, `LABEL_LIFT_K`, `LABEL_TILT`, `REST` (settled crystal angles). Texture size follows the quality tier (`labelTexture`). The text is decorative; the accessible text stays in the HTML.

## Assets

`public/models/{hero,portfolio,glass,plane}.glb` (`sky.glb` is no longer used) are Meshopt-compressed (~49 KB total).
**They are not in this zip** (they live on your machine at `Videos/blender/portfolio_assets/`; copy them into `public/models/`). Until you do, the site builds identical geometry in code, so it always runs.

Regenerate from Blender (builds in a temporary scene, does not touch yours):
```bash
blender -b -P blender/export_assets.py -- public/models
```
> The geometry and export settings in this script are the ones that produced your exported GLBs in Blender 5.2.1. The final tweak that makes it headless-safe (a `temp_override` context instead of switching the window's scene) could not be run before packaging, so if `blender -b` errors, run it from the Scripting tab instead and tell me.
Optional KTX2 project previews: put `public/previews/project-1.ktx2 … project-6.ktx2` (Basis transcoder is bundled); otherwise abstract UI mocks are painted at runtime.

## Not verified yet — please test on real devices

Visuals were checked in headless Chromium with a software renderer (screenshots of the hero, sky, shards and fragments), but **not on real GPUs**: real frame rates, shader compile on mobile GPUs and touch feel are untested. The updated crystal shapes in `blender/export_assets.py` are also untested in Blender (the site doesn't need them; it builds the same shapes in code). Type-check, build and the 70 logic tests pass. Suggested first pass: open with `?debug`, scroll through once on desktop, then on a mid/low-end phone, and tune `src/core/chapters.ts` (timing), `src/core/cameraRig.ts` (framing) and `TIERS` in `src/core/quality.ts`.

## Launch content, contact and loop

- **Copy** lives in `index.html`: the 3D journey (hero, six projects (five real, plus this site), two value messages, three service crystals, finale) followed by normal-flow, opaque sections (`#services`, `#process`, `#why`, CTA band, `#faq`, `#contact-form`, footer). Project cards link to the live sites; timelines and "fixed-price quote within one working day" are editable claims — change them to match what you can deliver.
- **Contact**: every CTA is a `mailto:aiensleyshield@gmail.com` link with a prefilled subject/body. The brief form builds its own mailto (`src/core/contact.ts`) and has a copy-address fallback. To change the address, edit `CONTACT_EMAIL` and find/replace it in `index.html` (a test fails if any mailto points elsewhere).
- **Separator**: `.after-gap` fades the 3D scene into the page, then a gradient hairline starts the opaque content. The journey range is the `#scroll-space` spacer, so extra content never changes the 3D timing.
- **Loop**: at the bottom, wheel / swipe / keys (or the footer button) fade through a veil and return to the top (`src/core/loop.ts`). Rendering pauses while opaque content covers the canvas.
- Brand name "Aetherworks" is a placeholder: replace it in `index.html` (title, header, footer, loader, JSON-LD).

## Sky chapter (shards)

Two long faceted glass blades (`shard_a/b`, scaled 1.7) enter from opposite upper corners, sweep across the frame and pass the lens on spline paths authored for the upward-looking camera (`SHARD_A/B` in `src/scenes/glass.ts`, camera keys 0.68–0.8). Single-pass shader glass only (Fresnel, sky reflection, dispersion, facet edges); the studio crystals stay hidden until their own chapter.

## Single-page structure (journey is the site)

Everything a visitor needs is inside the 3D journey, in conversion order; only the form and footer sit below it.

| Scene | Content | Interaction |
|---|---|---|
| Hero | Promise, CTAs, trust line | pointer parallax |
| Dive | one-line caption | none |
| Work ring | 5 live projects + this site | drag/flick, arrows, Visit live site |
| Cloud sea | **Process**: tunnel of 4 gates (`src/scenes/gates.ts`) | step buttons fly to a gate |
| Sky blades | **Why me**: 3 reasons per card | advance with scroll, dots pin one |
| Crystals | **Services** + timelines, ownership | tap a crystal |
| Plane finale | **Pick a destination** rings (`src/scenes/destinations.ts`) | click a ring: sets the form's project type and scrolls to it |
| Below | brief form (mailto) + footer | form |

Gates and rings are positioned relative to the camera after it is applied each frame, so the layout holds whatever the scripted camera does. Timings: `GATE_PROGRESS`, `OVERLAY_WINDOWS`, `DESTINATIONS` in `src/core/chapters.ts`. The journey length is `--journey` in `src/main.ts` (1000vh desktop, 880vh touch).
