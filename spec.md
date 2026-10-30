# Tether Treat — Product and Game Specification

**Document status:** running specification of the game on the StarHermit engine 1.29.0.  
**Game index:** 52  
**Genre:** Physics sequencing puzzle  
**Players:** 1 player; optional asynchronous score comparison  
**Targets:** desktop browsers, mobile browsers, landscape and portrait where practical  
**Rendering direction:** Three.js-first presentation with a fully usable semantic HTML interface layer

## 1. Product vision

Tether Treat is a game in which players cut ropes in the right order so a swinging treat collects stars and reaches its recipient. Its signature setting is a candy-colored mechanical playroom. The product should feel immediately understandable, responsive within one input, and polished enough that the board or playfield itself is the visual hero. Sessions should begin quickly, make the next useful action obvious without solving the game for the player, and end with a clear explanation of score and progress.

The experience must be original. Do not copy names, layouts, characters, iconography, writing, audio, progression maps, or level data from an existing title. Use an original visual language, original procedural assets, and internally authored content.

### Design pillars

1. **Readable before spectacular:** legal actions, hazards, selection, ownership, and goals remain legible with effects disabled.
2. **One-input confidence:** every press, tap, drag, key, or pointer action gives immediate visual and sonic acknowledgment.
3. **Short path to play:** a returning player reaches the primary playfield in at most two deliberate actions.
4. **Fair mastery:** randomness is seeded and inspectable; outcomes never depend on hidden purchases or invisible stat boosts.
5. **Scalable beauty:** the same art direction survives low-power mobile hardware and high-resolution desktop displays.

## 2. Core game design

### Objective and rules contract

Cut ropes in the right order so a swinging treat collects stars and reaches its recipient.

The rules engine must represent legal actions independently from rendering. It must expose legal-action queries, deterministic resolution, serializable state, a monotonically increasing turn/tick number, and a terminal-state reason. Tutorials and hints call the same legal-action API used by play rather than duplicating rules.

### Core loop

The repeated loop is: **inspect rope constraints, cut or activate one element, simulate motion, and collect objectives**. Input is locked only during the shortest non-interruptible resolution phase. Cosmetic animation may continue after the logical state is ready, but skip/fast-forward must settle every object into the exact deterministic end state.

### Scoring and victory

Score collected stars, remaining actions, and completion. Results show a component breakdown rather than one unexplained total. Store integers for score and simulation units; format values only in presentation. Ties use, in order: primary objective completion, fewer invalid actions, lower authoritative elapsed time, then stable session identifier.

### Modes

- **Learn:** interactive lessons introduce one rule at a time and require the player to perform the action.
- **Journey:** authored progression with gradually combined mechanics and periodic mastery stages.
- **Daily:** one shared seed and ruleset per UTC day, synchronized to platform time.
- **Practice:** selectable difficulty, restart, undo where rules permit, and no effect on competitive rating.
- **Challenge:** constrained goals such as move limits, speed targets, altered layouts, or restricted tools.
- **Score chase:** asynchronous global and friends comparisons using validated seeds and rulesets.

### Difficulty and content generation

- Represent content as versioned data: identifier, seed, initial state, goals, allowed mechanics, par values, tutorial flags, and presentation theme.
- Run offline validators to prove basic legality, reachable goals, bounded duration, and absence of soft locks. Logic puzzles additionally require a unique or explicitly accepted solution class.
- Difficulty is measured from solution depth, branching factor, time pressure, motor precision, hidden information, and recovery options—not merely larger numbers.
- Introduce one new concept in isolation, combine it with one known concept, then test mastery before adding another.
- Daily seeds are immutable after publication. If content is defective, mark the day excluded from ranking rather than silently replacing it.

### Game-state model

`boot → title → profile-ready → mode-select → preparing → tutorial/countdown → active ↔ paused/reconnecting → resolving → results → progression`.

Every transition has one owner and an explicit reason. Backgrounding pauses solo simulation. In hosted play, the authoritative clock continues where rules require it, while the returning client receives a fresh snapshot and a concise “while you were away” summary.

## 3. Interaction and user-interface design

### Information hierarchy

1. **Primary:** playfield, current objective, legal interaction target, and immediate danger or turn state.
2. **Secondary:** score/progress, remaining moves or time, opponent/party status where applicable.
3. **Tertiary:** settings, social controls, cosmetics, help, and history.

The 3D board is never the only UI: menus, text, settings and the action mirror are engine UI widgets (keyboard, pad and screen-reader reachable). Maintain a single shared layout model so DOM labels align with projected Three.js targets.

### Responsive layouts

- **Wide desktop (≥1024 CSS px):** centered playfield, objective/progression rail on the left, contextual actions and social/status rail on the right. Maximum line length is 70 characters.
- **Compact desktop/tablet:** playfield remains central; secondary rails collapse into drawers. Pointer hover may preview but never be required.
- **Portrait mobile:** top safe-area status bar, square or perspective-fit playfield, bottom thumb-zone action tray, and sheet-based secondary panels. Never place critical controls under browser chrome or display cutouts.
- **Large screens:** the runtime's UI scale magnifies the layout; the board renders at the runtime's render scale.
- **Landscape mobile:** the board fills the available height on the left and the objective/actions rails stack in a scrollable right column, so ropes, recipient and actions are visible together; preserve at least 44×44 CSS-pixel targets and 8-pixel separation.
- React to resize, orientation, device-pixel-ratio, safe-area insets, virtual keyboard, and visibility changes without losing input or restarting the round.

### Screens and overlays

- **Title/home:** Play is dominant; daily challenge, journey progress, and profile are one level below.
- **Mode setup:** show rules, expected duration, player count, assists, and whether the result is ranked before commitment.
- **Play HUD:** objective, progress, current actor/state, pause, and only context-relevant actions.
- **Pause/settings:** resume first; audio, graphics, controls, accessibility, help, and leave are clearly separated.
- **Results:** outcome headline, score breakdown, progress, achievements, comparison, replay/retry, and next recommended action.
- **Help:** visual rule cards generated from current control mappings and representative legal states.
- Daily challenge, local practice, pause, resume, results, and progression are first-class screens.

### Input

- Pointer/touch: raycast only against explicit interaction layers; use pointer capture for drags; cancel safely on lost capture.
- Touch: distinguish tap, drag, and camera gesture by distance/time thresholds; never require multi-touch for core play.
- Keyboard: directional navigation among legal targets, confirm, cancel, pause, undo/hint where valid, and camera reset.
- Gamepad: focus navigation, primary/secondary actions, pause, and remappable axes/buttons.
- Prevent accidental double commits with action identifiers, not arbitrary long debounce timers. Provide visible drag origin, target preview, and invalid-action explanation.
- Tapping a pick proxy maps it to its action (rope → cut, bubble → pop, fan → fan): tapping a bubble that holds the treat pops it, and an invalid tap shows its reason (e.g. "Nothing to pop yet.") in a tooltip centred just above the tapped point.
- The action mirror keeps one row and button per legal action and updates them in place when actions or sim events (stars, bounces, bubbles) refresh it, so a click always lands on the button it was pressed on and keyboard focus stays on its action.

### Accessibility

- Full keyboard operation and visible focus; DOM equivalents for canvas controls; headings and live regions for objective, turn, score, errors, and results.
- Color is reinforced by shape, texture, icon, or label. Include contrast-safe and common color-vision palettes.
- Reduced-motion mode removes camera swoops, shake, parallax, rapid particles, and large scaling while preserving event timing.
- Independent sliders for music, effects, ambience, and voice; captions/text cues for meaningful audio; no audio-only gameplay.
- Options for larger text, high contrast, left-handed controls, hold-versus-toggle, timing assistance, haptics off, and tutorial replay.
- Announce Three.js board state through a concise navigable model rather than describing every decorative object.

### Localization and language

Every player-facing string ships in nine locales (en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT) in `js/strings.js` (flat keys plus per-id maps for levels, blurbs, coach steps, worlds, mechanics, achievements, cosmetics) and `js/sh-i18n.js` (account lines). The language is the runtime's interface language (Options › Language, else the account's preferred language or the device's); a change shows on the next frame without restarting the round. "Morsel" is a proper name and is not translated.

## 4. Visual and audio design

### Visual contract

The subject is the active playfield at near-tabletop to room scale, framed so state changes occupy most of the screen. The scene is a candy-colored mechanical playroom. Use an authored camera, original procedural geometry, restrained environmental storytelling, and a deterministic visual seed. The no-post-processing baseline must still communicate hierarchy, depth, selection, and state.

### Three.js scene design

- Use physically based lighting and color management with one dominant key, soft environment fill, and contact grounding. Gameplay colors are tested after tone mapping.
- Build reusable semantic meshes for active pieces, board cells, obstacles, targets, and environment modules. Geometry detail follows silhouette importance and camera distance.
- Use instancing for repeated pieces and props, pooled effects, texture atlases where appropriate, and explicit disposal on scene changes.
- Separate render layers for environment, gameplay, selection/ghosts, effects, and UI anchors. Cosmetic particles never intercept raycasts.
- Selection uses a combination of lift/pose, outline or rim, and grounded marker—not bloom alone. Legal targets preview before commit; invalid targets explain why.
- Event hierarchy: input acknowledgment < legal move < combo/goal < round completion. Reserve camera motion, strong emission, and dense particles for the highest tier.
- Audio uses original short transients tied to logical events, layered material impacts, quiet ambience, and adaptive music stems. Randomized pitch/variant is seeded for replay consistency where recording matters.

### Graphics

The room is lit by a warm key light from upper-left-front, a hemisphere fill, a cool rim light from behind and (at Detailed) the room environment as image-based lighting, with ACES filmic tone mapping (exposure 1.05). At Detailed the back wall carries a procedural candy wallpaper with a skirting board over a glossy checker-tile floor; the treat is a clear-coated candy-striped swirl, stars are bevelled glossy gold with a pulsing glow, bubbles are clear-coated soap film, Morsel has glossy catchlight eyes and blinks, pegs and rims are polished metal, ropes are twisted bands. The runtime's graphics level (Options › Graphics) picks one of four looks (`native/quality.ts`, the old `js/gfx.js` presets and budgets):

| Tier | Shadows | Post | Materials | Tessellation | Textures | Burst pool | Sugar motes |
|---|---|---|---|---|---|---|---|
| Low | off | none (MSAA) | Lambert, plain room | ½ | plain | 32 | — |
| Balanced | 1024² | half-res bloom, grade, FXAA | Standard | ¾ | ×1 | 150 | 56 |
| High | 2048² | half-res GTAO + bloom, grade, SMAA | Physical (clear coat) | authored | ×1 | 180 | 70 |
| Ultra | 4096² | full-res GTAO (16 samples) + bloom, grade, MSAA | Physical | 1.5× | ×2 | 260 | 110 |

Pools and motes scale ≤ 2× within a tier by the level index. Engine minor 23 follows three.js r185: the old r160 page's light intensities are used as written, its own shadow camera (fitted to the framed play area), bias −0.0004, normal bias 0.03 and radius 3; `RoomEnvironment(renderer)` through PMREM (sigma 0.04), each lit material carrying it as its own envMap at the old envMapIntensity (wall 0.35, floor 0.3, bubbles 0.9, others 0.4), which is what r160 did with scene.environment. Bloom 0.45 / 0.35 / threshold 0.92 (the page's strength with bloom.model "r160"); the grade is the old display-space S-curve, saturation and vignette (`renderer.grade`). Render scale, adaptive resolution, frame-rate limit and readout are the runtime's. Motes, wallpaper drift and blinks stop under the runtime's Reduced motion option.

### Camera and motion

- Choose orthographic or low-distortion perspective according to depth requirements; expose framing constants rather than magic offsets.
- Camera transitions use authored duration/easing or critically damped springs and remain interruptible. Never animate by cumulative per-frame lerp.
- Decorative motion is paused or reduced when hidden. Gameplay animation derives from simulation state and interpolation alpha, not frame count.
- Camera shake is low-amplitude, event-tiered, disabled by reduced motion, and never changes raycast truth.

### Graphics-skill routing

During implementation, begin with `threejs-skill-router` and load only the following retained skills because they materially affect this visual target:

- `threejs-camera-direction` for deliberate framing and input-safe camera transitions
- `threejs-procedural-geometry` for authored, inspectable meshes instead of primitive-only placeholders
- `threejs-procedural-materials` for coherent PBR surfaces, perceptual parameters, and readable state masks
- `threejs-procedural-animation` for deterministic motion phases, springs, and interruption-safe transitions
- `threejs-procedural-vfx` for bounded particles, trails, impact accents, and event hierarchy
- `threejs-exposure-color-grading` for tone mapping, adaptation limits, and accessible color separation
- `threejs-image-pipeline` for explicit depth/color ownership and pass ordering
- `threejs-visual-validation` for fixed-view captures, seed sweeps, and performance evidence

Follow the skill pack's acceptance gate: deterministic seeds, debug views for controlling fields, perceptually grouped parameters, mechanism-backed quality tiers, and a readable no-post baseline. Do not add an effect merely because a skill exists.

### Performance budgets

- Target 60 fps at the default tier and a stable 30 fps fallback on constrained mobile hardware.
- Default active gameplay: ≤150 draw calls desktop, ≤90 mobile; ≤350k visible triangles desktop, ≤140k mobile; transient particles ≤20k desktop and ≤5k mobile.
- Cap device pixel ratio by quality tier; dynamically lower render scale before dropping simulation rate. UI text remains native resolution.
- Avoid runtime shader compilation during active play by prewarming required variants. Avoid per-frame allocations in simulation/render loops.
- Quality tiers independently control shadows, environment detail, particles, post effects, antialiasing, and render scale; they never alter rules or visibility of hazards.

## 5. Technical architecture (StarHermit engine 1.29.0, host API 1.31, engine.minor 31)

A StarHermit engine script game (`starhermit.txt`: `engine.entry=native/main.ts`, `engine.version=1.29.0`, `engine.minor=31`, capabilities platform, storage, clipboard), played natively by the StarHermit client and in browsers by the engine's web runtime through the loader `index.html` that `npm run package` writes with `starhermit-files.json`.

- `js/` (pure, shared with node tests and `server.js`): `physics.js` (integer fixed-point physics, 120 Hz), `rules.js`, `rng.js`, `content.js` (themes, generators, validators, hints, achievements, cosmetics), `levels.js`, `session.js` (validated commands, undo, lesson steps, settle), `save.js` (save model), `strings.js` / `sh-i18n.js` (nine locales).
- `native/main.ts`: the state machine (title → screens → countdown → active ⇄ paused → resolving → results), the simulation on the runtime's fixed steps (`setFixedRate(120)`: one rules tick per step; the countdown — 3, 2, 1, Go! at 0.65 s each, or Go! for 0.4 s under reduced motion — and the 1.3 s / 0.3 s resolve delay are counted in steps), actions, input, results and lifecycle (a hidden window pauses the round).
- `native/render.ts` (`starhermit:scene`), `native/screens.ts` (`starhermit:ui`, styles from `tools/ui-style.css` → `assets/ui-style.json`), `native/audio.ts` (`starhermit:audio`), `native/platform.ts` (saves, options, score posting, leaderboard pages), `native/i18n.ts`, `native/quality.ts`, `native/style.ts`.

### Screens and layout
Header (title, player name and sync state when signed in, total stars). The board's box sits in the page as the old CSS laid it out: from 1024 logical px wide three columns (an empty objective column, the board, a 280 px actions rail); narrower, stacked (board square in portrait, 4:3 sideways, the rails below — above with the left-handed layout); short landscape (≤ 500 px tall) the board the full height and the rails a scrolling column beside it. The camera is fitted to that box and shown there with a view offset. Over the board: the HUD (objective, stars, actions against par or moves left, the time limit), the lesson coach, the invalid-tap tooltip. The rail holds the action bar (Undo — hidden in no-undo rounds —, Hint, Restart, Skip ▸▸, Pause) and the action mirror (a button per legal action: Snip rope-0, Pop bubble-0, Fan fan-0 on/off; the keyboard-focused one ringed). Screens are modal panels: Title (Play/Continue Journey, Daily Drop with its countdown to the next UTC day, Learn, Practice, Challenge, Score Chase; Journey map, Settings, Help, Sign in / Invite), Journey map (stages unlock in order), Challenges, Practice (Easy / Medium / Hard), Score Chase (Global, Daily, Friends: the high-score board's top 20; offline or signed out the local board), Settings (left-handed layout, the three cosmetic slots unlocked by stars, reset tutorial progress, Open Options and Key bindings for the runtime's own settings), Help (rule cards and the effective key bindings), Pause (Resume, Restart, Settings, Quit to title), Results (headline, reason, stars, score breakdown, par facts, local-board note, achievements, leaderboard line, Retry / Next stage or Next lesson / Mode select).

### Controls
Keys (rebindable in the runtime's Options): ←/↑ previous target, →/↓ next target, Enter/Space confirm the focused target, Escape pause/resume, U undo, H hint, R restart (also from the results), C reset camera. Pads: D-pad / left stick cycle, South confirm, East and Start pause, North hint, West undo, left shoulder restart, right stick press camera. Pointer and touch on the board: a tap (≤ 12 px, ≤ 0.4 s) on a rope (0.45 corridor), a bubble or a fan acts on it; a swipe across ropes cuts every legal one it crosses; an invalid tap shows its reason above the finger and wobbles the board; the mouse's hover previews the legal target. UI presses never reach the board (`ui.pointerCaptured()`).

### Sound
The authored one-shots (`sfx/*.opus`) per rules event and the error buzz; the music (the old sine arpeggio on the theme's base frequency, a note every 840 ms) and the low-passed noise pad rendered into clips on the music bus. Volumes, mute and the voice limit are the runtime's Options.

### Settings, saves and platform
The save (`saves`, schema 1) is `{ v: 1, progress }` (levels, lessons, achievements, daily days, cosmetics, Continue target, local board), on the device and in the account's cloud slot; another device's save merges in (best per stage, unions; this device's cosmetics win on a conflict). The browser build's cloud slot (`{ savedAt, progress }`, game:<slug>) is merged once (its cosmetics winning, as the old start did) and replaced. The left-handed layout is an engine setting; the old settings KV keys (volumes, mute, graphics, reduced motion, high contrast, larger text, leftHanded, ui.language) are adopted (leftHanded) and removed. High contrast, larger text, reduced motion and language are the runtime's options. Guests' old browser localStorage progress does not migrate. Signed in, finished Journey, Daily and Challenge rounds post their total through `score-script.js` (range-checked, 0–100,000) to `high-score` and the results show the rank. The Daily's date comes from the platform clock, else the device's UTC date ("local clock").

### Checks
`npm test`: `tests/run-tests.js` and `tests/extended-tests.js` (rules, content, replay), `tests/i18n.test.js` (every string the client draws in nine locales), `tests/save.test.mjs`, then `tests/native.mjs` (web index up to date, tsc, `starhermit check .` with no warnings, the play scripts in `tests/native/` generated by `tools/gen-plays.mjs` from the authored solutions: Journey 1–4 by mouse, Learn on a DPR-3 phone by a swipe and a timed tap, all six lessons, a lost Challenge, Practice sideways with undo/hint/pause/skip/retry, the menus). `npm run test:browser` (`tools/browser-play.mjs`) plays the web package on the GPU at desktop, phone and landscape (DPR 3).

### Known limitations
- The engine does not draw MeshPhysicalMaterial sheen (Morsel) or iridescence (bubbles); they keep their clear coat. The 6 px backdrop blur behind screens is not drawn.
- The old grade's vignette was centred on the board's canvas; the runtime's is centred on the window.
- Fixed in the port: the browser build advanced a lesson step only on a simulation tick's events, so Learn 5 (fan on, then snip) could never reach its snip step; the session now advances on the action itself.
- The authored solutions for the mirrored challenges and the sliders are not replayed by the play-script generator (their triggers are mirrored or tick-bound); the rules tests cover them.

## 7. Content, economy, and retention

- Launch scope: tutorial sequence, at least 40 authored stages or equivalent procedural depth, daily challenge, practice, five visual themes, and a mastery track.
- Cosmetic rewards may alter materials, trails, board surrounds, ambience, or profile flourishes, but never hitboxes, timing windows, information, or power.
- Reward cadence: early feedback every session, meaningful unlock every 3–5 sessions, and long-term goals visible without manipulative countdowns.
- No real-money wagering, paid random rewards, forced advertising, energy pressure, punitive streak loss, or purchases that affect competitive outcomes.
- Notifications, if ever added by the host, are opt-in, frequency-capped, quiet-hour aware, and never use false urgency.

## 8. Analytics and privacy

Measure tutorial completion, first meaningful action time, session duration bands, level attempts, quit state, input modality, performance tier, reconnect success, and accessibility feature usage only in aggregate. Use random session identifiers, short retention, and explicit consent where required. Never collect message content, drawings, voice, private board notes, or exact pointer trails as analytics.

Success targets for the first public test: median first-play time under 20 seconds, tutorial completion above 80%, crash-free sessions above 99.5%, p95 input acknowledgment below 100 ms locally, and at least 95% of supported mobile sessions holding their selected frame-rate tier.

## 9. Testing and acceptance criteria

### Rules and content

- Unit-test every legal action, invalid-action reason, scoring component, terminal state, and serialization migration.
- Property-test deterministic replay: the same version, seed, and commands produce identical state hashes.
- Fuzz malformed commands and generated content; prove no hangs, NaN physics, impossible mandatory states, or unbounded loops.
- Golden-test representative easy, medium, hard, interrupted, resumed, and terminal sessions.

### Interface and accessibility

- Test pointer, coarse touch, keyboard-only, gamepad, screen reader, zoom to 200%, reduced motion, high contrast, safe areas, and both mobile orientations.
- Verify focus restoration after every modal, meaningful live announcements, no keyboard traps, and no hover-only instructions.
- Confirm all critical labels fit translated strings at 30% expansion and support right-to-left layout where localized.

### Graphics and performance

- Produce fixed-camera captures for every quality tier, deterministic seed sweeps, no-post baselines, debug-view mosaics, and 10-minute temporal stability runs.
- Profile CPU, GPU, memory, shader compilation, draw calls, triangles, texture memory, and garbage collection on representative desktop and mobile classes.
- Verify effects cannot obscure legal targets, alter picking, leak resources, or continue expensive updates while hidden.

### Platform and network

- Test expired/rotated tokens, privacy settings, rate limits, offline start, reconnect at each game state, duplicate commands, out-of-order events, server restart, and version mismatch.
- Verify achievement idempotency, leaderboard validation, friends-only filtering, cloud-save conflict handling, activity start/end pairing, and server-time countdown accuracy.
- For hosted sessions, test disconnect/rejoin, abandonment, timeout, invitation expiry, result reconciliation, replay access, moderation controls, and authoritative cheat attempts.

## 10. Definition of done and non-goals

This specification is ready for implementation when rules examples, content schema, wireframes for all responsive breakpoints, visual target frames, accessibility annotations, authoritative message schema, achievement definitions, leaderboard definitions, and performance test devices are approved.

This document does **not** authorize implementation, asset production, monetization work, native wrappers, real-money systems, or copying any existing product. The initial build should favor one excellent core loop and a coherent original visual identity over feature breadth.

