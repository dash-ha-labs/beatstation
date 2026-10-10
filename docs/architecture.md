# Architecture — beatstation

> Baseline: cloned from [Dronzer2code/Krisp](https://github.com/Dronzer2code/Krisp)
> (upstream snapshot 2026-10-05) as the starting point for a kid-friendly beat station.
> The audio engine is retained as-is; see the product brief for what changes on top of this baseline.

## What the app is

A single-page browser app for making beats: a step sequencer to program beats, a song
arranger to lay them across bars, a mixer (channel strips + master chain), in-browser AI
variations, and WAV/MIDI export. The full feature matrix lives in upstream
`docs/PRD.md`; this page describes how the code is put together.

## Stack

| Concern | Choice |
|---|---|
| Build | Vite 7 + TypeScript (strict), React 18 |
| Styling | Tailwind 3 driven by CSS variables in `src/theme/tokens.css` |
| State | zustand — one store for the open workspace + undo history |
| Audio | Tone.js 15 (synths, players, EQ3, compressor, limiter, reverb, offline render) |
| AI (browser-side) | @magenta/music (MusicVAE / GrooVAE / DrumRNN), lazy-loaded |
| Embeddings | @huggingface/transformers (all-MiniLM-L6-v2) for sound search |
| MIDI | @tonejs/midi (export only) |
| Tests | vitest (pure-logic tests in `tests/`) |
| Deploy | Static SPA on nginx via Dockerfile → https://beatstation.yamu.app |

## Repository layout

```text
index.html            Vite entry
src/
  main.tsx            React root
  App.tsx             Route switch (home / workspace / dev screens) + PasscodeGate + Announcer
  router.tsx          Hash-based routing
  screens/
    Home.tsx          Landing: workspace list, presets, guide
    Workspace.tsx     The studio screen (lazy-loaded)
    workspace/        ~25 components: TransportBar, Rack, BeatEditor, Song, Mixer,
                      SoundBrowser, ExportDialog, SidePanel, AIPanel, …
  audio/              The audio engine (see below) — engine, voices, scheduler,
                      context, buffers, analyze, export-wav, export-midi, wav-encoder
  store/              zustand store: workspace, history (undo), ops, selectors,
                      library, ui, layout
  model/              types.ts, ids.ts, time.ts, defaults.ts (4/4, 16th-note grid)
  presets/            kit.ts (8-slot synth kit), beats.ts (8 original preset beats)
  ai/                 magenta.ts (lazy model loading), tools.ts, convert.ts, embed.ts
  api/                Frontend API client (client.ts, sounds.ts, playlists.ts, workspaces.ts)
  ui/                 Shared primitives: Dialog, Menu, Tabs, Toggle, Chip, Meter, icons, drag
  theme/tokens.css    Design tokens — single source of the color palette
api/                  Serverless functions (upstream: Vercel Node functions)
db/                   schema.sql + migrations (upstream: Tiger Data / Postgres + pgvector)
tests/                vitest suites (scheduler, store, export, presets, layout, …)
docs/                 Upstream product docs (PRD, TRD, UI_DESIGN, …) + this page
Dockerfile            Multi-stage: node:22-alpine build → nginx:alpine serve, SPA fallback
```

## Audio engine (`src/audio/`)

All sound runs client-side in the Web Audio API via Tone.js; nothing about playback
depends on a server.

- **Signal chain** — per slot: `voice → Velocity Gain → EQ3 → Volume → Mute gate → Panner
  → Meter`, with a send to the shared reverb; master bus: `EQ3 → Compressor → Limiter →
  Volume → tanh ceiling clipper → Meter → Destination` (`src/audio/engine.ts`).
- **Voices** (`voices.ts`) — `SynthVoice` (Tone synths for the 8-slot kit), `SampleVoice`
  (uploaded/library sounds), `BakedMetalVoice`.
- **Scheduling** (`scheduler.ts`) — pure timing functions (step seconds, swing, humanize
  offsets, loop wrapping) that are unit-tested separately from the one Transport binding.
  4/4 only, 16th-note grid, BPM 60–200, swing 0–0.6.
- **Context** (`context.ts`) — `Tone.start()` runs on the first user gesture; the same
  `createEngine(context)` factory drives both the live context and offline contexts, so
  WAV export (`export-wav.ts`) renders through the identical engine.
- **Export** — WAV mixdown via offline render + `wav-encoder.ts`; MIDI GM drums via
  `@tonejs/midi`.

The engine is the part of this codebase that must not be regressed by later UI work.

## State model

One zustand store (`src/store/workspace.ts`) holds the open workspace plus an undo
history. Edits run in three modes: `push` (normal edit → one undo entry), `gesture`
(drag → collapsed into one entry on pointer-up), `silent` (selection → no entry, still
autosaves). `revision` increments on every change and drives autosave. Pure helpers live
in `ops.ts` / `selectors.ts`; `presets/beats.ts` holds the 8 original preset beats.

## Backend surface and why it is dormant here

Upstream Krisp ships same-origin serverless functions (`api/*.ts`, Vercel Node runtime)
backed by Tiger Data Postgres for: workspace save/load, a shared sound library, upload,
ElevenLabs sound generation, and hybrid vector+keyword search. `db/schema.sql` is its
schema.

beatstation's constraint is **no external APIs** (and no paid third-party service for a
kids' product), and this Dokploy deployment is a static SPA (nginx) that does not run
Node functions. Consequences, all by design:

- The frontend client (`src/api/client.ts`) surfaces `api_unavailable` when `/api/*`
  does not return JSON; core beat-making, mixing, AI variations and export never touch
  the API and work fully offline.
- Features that require the backend are inactive on this deployment: saving workspaces
  to a server (work remains in the browser session), the shared sound library, uploads,
  ElevenLabs generation and sound search. The `PasscodeGate` dialog only opens in
  response to a 401 from an API call, so it never appears while the API is dormant.
- `api/`, `db/` and their tests stay in the repo untouched so the backend can be
  revisited later without archaeology.

If server persistence is ever wanted, the options are: run the functions behind a small
Node server in the same container, or move persistence to the browser
(localStorage/IndexedDB) — a product decision, not part of this baseline.

## Configuration

- No runtime environment variables are needed for the static deployment.
- `.env.example` lists upstream backend-only values (`TIGER_DATABASE_URL`,
  `ELEVENLABS_API_KEY`, `APP_PASSCODE`, `DAILY_SOUND_LIMIT`); none are used by the SPA.
- Build: `npm ci && npm run build` → `dist/` (the `tsc --noEmit` typecheck is part of the
  build script and passes).

## Theming / palette

All colors are CSS variables in `src/theme/tokens.css` (warm paper surfaces `#D9D4C9`
family, graphite panels, orange LED accent `#FF6A00`, LCD amber `#FF8A3D`), mapped into
Tailwind via `tailwind.config.ts`. Keeping the Krisp palette for now means changing
`tokens.css` is the single point of control for the future kids' reskin.

Kids reskin (task t_0d35129e): the palette is unchanged; the same tokens now render a
friendlier, cleaner surface — rounder corners (`--r-lg/md/sm/pad` 22/16/12/14 px), a
40 px `--touch` target, larger type (`--label` 11 px, `--text` 14 px, `--title` 16 px),
40 px touch pads in 48 px rows (Rack rows align via `screens/workspace/layout.ts`), a
firmer lit-pad state (solid fill + light rim), and kid-facing copy ("Beatstation",
"projects"). The server save-status LED is hidden in the Transport (the static deploy
keeps work in the browser session); all save/AI/export machinery is untouched.
Landscape phones/tablets (M2): `src/ui/landscapeFit.ts` scales the whole studio to the
screen via the meta viewport while active (`fit-screen` locks the page to one screen;
the Song section scrolls internally) and restores the default viewport otherwise.

## Tests

`npm run test` runs vitest suites over pure logic: scheduler timing, store/history,
presets, export, WAV encoding, layout math, tokens consistency, and upstream API/db
units. `npm run lint` runs eslint. There are no browser/e2e tests.

## Deployment

Dokploy builds the repo Dockerfile (multi-stage: `node:22-alpine` build →
`nginx:alpine` serve, SPA fallback on port 80) and serves it at
https://beatstation.yamu.app with auto-deploy on push to `main`. Verify with HTTP 200 on
`/`, `/index.html` and hashed `assets/*` files with the right MIME types.
