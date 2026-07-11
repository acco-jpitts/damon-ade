---
name: run-desktop
description: Build, launch, screenshot, and drive the ADE Electron desktop app (@ade/desktop). Use when asked to run/start the desktop app, take a screenshot of ADE, click or inspect its UI, or confirm a change works in the real running app.
---

ADE is a local-first Electron desktop app (React 19 + TanStack Router renderer,
Node main process). It has a GUI window, so an agent drives it programmatically
over **Chrome DevTools Protocol**: the main process opens a CDP port at startup
(`DESKTOP_AUTOMATION_PORT`, default **41729**) in
`src/lib/electron-app/factories/app/setup.ts`. The committed driver
**`.claude/skills/run-desktop/driver.mjs`** is a dependency-free CDP client
(`bun`, no npm deps) that screenshots, evals, and clicks the running app.

**All paths below are relative to `apps/desktop/`.** Verified on Windows 11
(the app's primary platform). The driver runs `electron.exe` from
`node_modules`; a build already exists in `dist/` on a set-up dev machine.

## Prerequisites

- **bun** (repo package manager) and the repo already installed (`bun install`
  from the repo root). Installation rebuilds native modules for Electron —
  on Windows this needs VS Build Tools + the "Spectre-mitigated libraries"
  component; see the root `CLAUDE.md` "Native modules" section. It's already
  done on this machine.
- Verify the one NAN native module (better-sqlite3) matches Electron's ABI —
  a `NODE_MODULE_VERSION` throw here means it wasn't rebuilt for Electron:

```bash
cd apps/desktop
printf "%s" "try{require(process.cwd()+'/node_modules/better-sqlite3');console.log('OK better-sqlite3 loads under Electron ABI')}catch(e){console.log('FAIL:',e.message.split('\n')[0])}" > /tmp/probe.cjs
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron /tmp/probe.cjs
# -> OK better-sqlite3 loads under Electron ABI
```

## Build

`dist/` is **gitignored** — a clean clone has none and must build it. Build
output lands in `dist/{main,preload,renderer}`:

```bash
cd apps/desktop
bun run compile:app
```

⚠️ In the **current working tree** this fails at the renderer stage with
`Missing "./lib/common/events.js" specifier in "vscode-jsonrpc"` (a transitive
version conflict — 8.2.0/8.2.1/9.0.1 are all installed). `main` and `preload`
bundles build fine; only the client build breaks. The shipped `dist/` predates
this dep change. See Troubleshooting. If `dist/` already exists, skip straight
to Run.

## Run (agent path)

Launch the built app in the background with CDP enabled, then drive it with the
driver. `SKIP_ENV_VALIDATION=1` bypasses env validation + the sign-in screen.

**Use the default port 41729 if it's free.** If a stale process holds it (the
launch log prints `Cannot start http server for devtools`), pick another port
and pass the same value to the driver's `--port`. This session used 41730:

```bash
cd apps/desktop
DESKTOP_AUTOMATION_PORT=41730 SKIP_ENV_VALIDATION=1 bunx electron .   # run in background
```

Wait for CDP to come up (the window opens in ~2–5s), then drive it:

```bash
# readiness poll — NOTE: 127.0.0.1, not localhost (see Gotchas)
until curl -s --max-time 1 http://127.0.0.1:41730/json/version >/dev/null; do sleep 1; done

D=.claude/skills/run-desktop/driver.mjs
bun "$D" --port 41730 info                 # target url + title
bun "$D" --port 41730 shot 01-workspace    # screenshot -> $TMP/ade-shots/01-workspace.png
bun "$D" --port 41730 text                 # innerText of the whole page
bun "$D" --port 41730 eval "location.hash" # run JS in the renderer
bun "$D" --port 41730 click-text "Agent Files"   # click a button/tab/link by text
bun "$D" --port 41730 quit                 # close the app
```

Screenshots land in `$TMP/ade-shots/` (override with `SHOT_DIR`). **Open the PNG
and look at it** — verifying a change means seeing the real UI, not a green test.

### Driver commands

| command | what it does |
|---|---|
| `info` | active page target url + title |
| `targets` | list all CDP targets (find the real page) |
| `shot [name]` | PNG → `$SHOT_DIR/<name>.png` |
| `eval <js>` | `Runtime.evaluate`, prints JSON result |
| `text [cssSel]` | innerText of selector (default `body`) |
| `click <cssSel>` | DOM `.click()` first match |
| `click-text <text>` | click first button/link/`[role=button|tab|menuitem]` containing text |
| `quit` | `Browser.close` the app |

Port: `--port N` or `DESKTOP_AUTOMATION_PORT` env (default 41729).

**Off-the-shelf alternative:** if the `desktop-automation` MCP is configured in
your agent environment and the app runs on the default **41729**, its
`mcp__desktop-automation__*` tools (`take_screenshot`, `inspect_dom`, `click`,
`evaluate_js`, `navigate`) drive the same CDP port with no script.

## Run (human path)

`bunx electron .` from `apps/desktop` opens the window normally (no CDP needed).
Useful only with a display attached. Close the window to quit.

## Test

```bash
cd apps/desktop
bun test                       # ~921 tests / 61 files, ~10s
bun test src/.../foo.test.ts   # a single file
```

Current working tree has ~64 failing tests (e.g. `FilePathLinkProvider`
link-provider cases) — a suite failure count ≠ your change being broken here.

## Gotchas

- **Use `127.0.0.1`, never `localhost`.** CDP listens on **IPv4 only**, but
  bun/node (and some curl builds) resolve `localhost` → IPv6 `::1`, where nothing
  listens → connect fails. `127.0.0.1` works for both the HTTP `/json` endpoint
  and the WebSocket, and CDP's host guard accepts the `127.0.0.1` Host header
  (IP literals are allowed). The `/json` response hands back a
  `ws://localhost:...` URL that hits the same IPv6 dead-end — the driver rewrites
  it to `127.0.0.1`. So: `bun -e "fetch('http://127.0.0.1:PORT/json')"` works,
  `...localhost...` does **not**.
- **Port 41729 is often already taken by a stale run.** Electron logs
  `bind() returned an error ... Only one usage of each socket address` +
  `Cannot start http server for devtools`, the app still runs but has no CDP,
  and the driver reports "no page target". Relaunch with a fresh
  `DESKTOP_AUTOMATION_PORT` and matching `--port`.
- **A launch backgrounded with `&` inside one shell dies when that shell
  exits.** Launch the app as a real background job (e.g. the harness's
  `run_in_background`), not `bunx electron . &` in a throwaway command.
- **`ELECTRON_RUN_AS_NODE` processes are the terminal-host daemon, not the GUI.**
  A running `electron.exe` whose command line ends in `dist/main/terminal-host.js`
  is the detached PTY daemon — it survives app restarts by design and does **not**
  hold the GUI single-instance lock or a CDP port. Don't kill it expecting to
  free the app.
- **The app is single-instance** (`app.requestSingleInstanceLock()`). A second
  `bunx electron .` against the same userData signals the first and exits — you
  can't run two GUI instances to drive independently.
- **Screenshot/eval only need the app running**, not a build — the driver
  attaches to whatever's live on the port. But the *content* is real user data
  (`~/.ade/`): teams, agents, live terminals. Clicks have real side effects
  (create agents, run shell commands); prefer `eval`/`text`/`shot` and
  reversible clicks (tab switches) when poking someone's live app.

## Troubleshooting

- **`compile:app` → `Missing "./lib/common/events.js" specifier in
  "vscode-jsonrpc"`:** transitive version conflict (8.2.0/8.2.1/9.0.1 all under
  `node_modules/.bun/`). Current-working-tree only; the released `dist/` built
  before it. Not fixed here (dependency-graph surgery, out of scope for running
  the app). Run the existing `dist/` instead, or dedupe `vscode-jsonrpc` to a
  single version.
- **Driver: "no page target on :PORT":** the app isn't running with CDP on that
  port. Check `curl http://127.0.0.1:PORT/json` (use 127.0.0.1). If empty, the
  port bind failed — see the port-taken gotcha; relaunch on a free port.
- **`ERROR: Unable to connect`** from the driver: you're hitting IPv6
  `localhost`. The driver forces `127.0.0.1`; if you copied a raw `fetch`, do
  the same.
- **App won't start / terminals dead:** first look at `~/.ade/daemon.log` (the
  terminal-host daemon's output) and the electron stdout from launch.
- **`NODE_MODULE_VERSION` mismatch at launch:** better-sqlite3 built for Node,
  not Electron. Re-run `bun run --filter=@ade/desktop install:deps`
  (electron-builder rebuild). Confirm with the probe in Prerequisites.
