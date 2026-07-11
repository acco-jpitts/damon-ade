#!/usr/bin/env bun
// CDP driver for the ADE Electron desktop app.
// The app enables Chrome DevTools Protocol on DESKTOP_AUTOMATION_PORT (default
// 41729) at startup (src/lib/electron-app/factories/app/setup.ts). This talks
// to that port over a raw WebSocket — no deps. Run with `bun` or node 22+
// (both have global fetch + WebSocket).
//
// Usage (app must already be running with CDP):
//   bun driver.mjs info                 target url + title
//   bun driver.mjs targets              list all CDP targets
//   bun driver.mjs shot [name]          screenshot -> $SHOT_DIR/<name>.png
//   bun driver.mjs eval '<js expr>'     Runtime.evaluate, prints JSON result
//   bun driver.mjs text [cssSelector]   innerText of selector (default body)
//   bun driver.mjs click <cssSelector>  DOM .click() on first match
//   bun driver.mjs click-text <text>    click first button/link/[role=button] containing text
//   bun driver.mjs quit                 close the app (CDP Browser.close)
//
// Port:     --port N   or  DESKTOP_AUTOMATION_PORT env  (default 41729)
// Host:     forced to 127.0.0.1 — CDP listens on IPv4 only, and bun/node
//           resolve "localhost" to IPv6 ::1 (nothing there) → connect fails.
//           CDP's host guard allows IP literals, so 127.0.0.1 is accepted.
// Shots to: SHOT_DIR env, else <os-temp>/ade-shots.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const args = process.argv.slice(2);
let port = process.env.DESKTOP_AUTOMATION_PORT || "41729";
const pi = args.indexOf("--port");
if (pi !== -1) { port = args[pi + 1]; args.splice(pi, 2); }
const [cmd, ...rest] = args;
const arg = rest.join(" ");

const SHOT_DIR = process.env.SHOT_DIR || path.join(os.tmpdir(), "ade-shots");
const HOST = `127.0.0.1:${port}`; // IPv4 — see header note
const ipv4 = (u) => u.replace("localhost", "127.0.0.1").replace("[::1]", "127.0.0.1");

async function pickPageTarget() {
  const res = await fetch(`http://${HOST}/json`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === "page" && !t.url.startsWith("devtools://"));
  if (!page) throw new Error(`no page target on :${port}. Is ADE running with CDP? targets=${targets.length}`);
  return page;
}

// One CDP round-trip over a fresh WebSocket, then close.
function cdp(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = 1;
    const timer = setTimeout(() => { ws.close(); reject(new Error(`timeout ${method}`)); }, 15000);
    ws.onopen = () => ws.send(JSON.stringify({ id, method, params }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.close();
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
      else resolve(msg.result);
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error(`ws error ${wsUrl}`)); };
  });
}

async function evaluate(wsUrl, expression) {
  const r = await cdp(wsUrl, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

const CLICK_JS = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return 'NOT_FOUND'; el.scrollIntoView(); el.click(); return 'OK: ' + el.tagName; })()`;

const CLICK_TEXT_JS = (t) => `(() => {
  const els = [...document.querySelectorAll('button, a, [role="button"], [role="tab"], [role="menuitem"]')];
  const el = els.find(e => e.textContent?.trim() === ${JSON.stringify(t)})
          ?? els.find(e => e.textContent?.includes(${JSON.stringify(t)}));
  if (!el) return 'NOT_FOUND'; el.scrollIntoView(); el.click(); return 'OK: ' + el.tagName; })()`;

async function main() {
  if (cmd === "targets") {
    const res = await fetch(`http://${HOST}/json`);
    for (const t of await res.json()) console.log(`[${t.type}] ${t.title}\n    ${t.url}`);
    return;
  }
  if (cmd === "quit") {
    // The app's before-quit handler (src/main/index.ts) preventDefaults the
    // first quit to run async cleanup, so Browser.close often needs two tries.
    const alive = async () => fetch(`http://${HOST}/json/version`).then(() => true).catch(() => false);
    for (let i = 0; i < 4 && (await alive()); i++) {
      const v = await fetch(`http://${HOST}/json/version`).then((r) => r.json()).catch(() => null);
      if (v) await cdp(ipv4(v.webSocketDebuggerUrl), "Browser.close").catch(() => {});
      await new Promise((r) => setTimeout(r, 800));
    }
    console.log((await alive()) ? "still up — kill the launch process manually" : "closed");
    return;
  }
  const page = await pickPageTarget();
  const ws = ipv4(page.webSocketDebuggerUrl);

  switch (cmd) {
    case "info":
      console.log(JSON.stringify({ title: page.title, url: page.url }, null, 2));
      break;
    case "shot": {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      const r = await cdp(ws, "Page.captureScreenshot", { format: "png" });
      const file = path.join(SHOT_DIR, `${arg || `ss-${Date.now()}`}.png`);
      fs.writeFileSync(file, Buffer.from(r.data, "base64"));
      console.log(file);
      break;
    }
    case "eval":
      console.log(JSON.stringify(await evaluate(ws, arg), null, 2));
      break;
    case "text":
      console.log(await evaluate(ws, `(${JSON.stringify(arg)} ? document.querySelector(${JSON.stringify(arg)}) : document.body)?.innerText ?? '(null)'`));
      break;
    case "click":
      console.log(await evaluate(ws, CLICK_JS(arg)));
      break;
    case "click-text":
      console.log(await evaluate(ws, CLICK_TEXT_JS(arg)));
      break;
    default:
      console.log("commands: info | targets | shot [name] | eval <js> | text [sel] | click <sel> | click-text <text> | quit");
      process.exit(1);
  }
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
