#!/usr/bin/env bun
/**
 * Hardened build for the desktop app — wraps `compile:app` with fixes for
 * two pitfalls that otherwise produce a build that launches to a blank
 * window or crashes at boot:
 *
 * 1. `compile:app` always rebuilds dist/main + dist/preload fresh (in
 *    production mode), which is what unbakes a stale NODE_ENV=development
 *    left over from a prior `bun run dev` (that mode makes the app try to
 *    load a Vite dev server instead of dist/renderer). Never skip straight
 *    to `bunx electron .` on an old dist/ without rebuilding first.
 * 2. `bun install` can silently swap better-sqlite3's Electron-rebuilt
 *    .node binary for a Node-ABI prebuild, while a stale `.forge-meta`
 *    marker tricks `@electron/rebuild` into skipping the fix on the next
 *    `install:deps` run. This script verifies the ABI after building and,
 *    if it's wrong, deletes the marker(s) and forces a real rebuild.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const projectRoot = join(import.meta.dirname, "..");
const repoRoot = join(projectRoot, "..", "..");
const isWindows = process.platform === "win32";
const electronBin = join(
	projectRoot,
	"node_modules",
	".bin",
	isWindows ? "electron.exe" : "electron",
);

function log(message: string): void {
	console.log(`[build-app] ${message}`);
}

function fail(message: string): never {
	console.error(`[build-app] ${message}`);
	process.exit(1);
}

function run(cmd: string, args: string[]): void {
	log(`$ ${cmd} ${args.join(" ")}`);
	execFileSync(cmd, args, {
		cwd: projectRoot,
		stdio: "inherit",
		shell: isWindows,
	});
}

function betterSqlite3LoadsUnderElectron(): boolean {
	try {
		execFileSync(electronBin, ["-e", "require('better-sqlite3')"], {
			cwd: projectRoot,
			env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
			stdio: "pipe",
		});
		return true;
	} catch {
		return false;
	}
}

// bun's store folder name embeds the version (better-sqlite3@X.Y.Z), so glob
// for it rather than hardcoding a version that will drift.
function findForgeMetaMarkers(): string[] {
	const bunStore = join(repoRoot, "node_modules", ".bun");
	if (!existsSync(bunStore)) return [];
	return readdirSync(bunStore)
		.filter((name) => name.startsWith("better-sqlite3@"))
		.map((name) =>
			join(
				bunStore,
				name,
				"node_modules",
				"better-sqlite3",
				"build",
				"Release",
				".forge-meta",
			),
		)
		.filter(existsSync);
}

function warnIfJsonrpcOverridesMissing(): void {
	const { overrides } = JSON.parse(
		readFileSync(join(repoRoot, "package.json"), "utf8"),
	) as { overrides?: Record<string, string> };
	if (!overrides?.["vscode-jsonrpc"] || !overrides?.["vscode-languageserver-protocol"]) {
		log(
			"WARNING: root package.json is missing the vscode-jsonrpc/vscode-languageserver-protocol " +
				"overrides. Without them, mastracode's floating 'latest' pin can drag in a " +
				"vscode-jsonrpc version whose stricter package 'exports' break langium's deep " +
				"imports, failing the renderer build with " +
				'`Missing "./lib/common/events.js" specifier in "vscode-jsonrpc"`. ' +
				'See root CLAUDE.md "Native modules" section.',
		);
	}
}

function main(): void {
	warnIfJsonrpcOverridesMissing();

	run("bun", ["run", "compile:app"]);

	if (betterSqlite3LoadsUnderElectron()) {
		log("better-sqlite3 already matches Electron's ABI — done.");
		return;
	}

	log("better-sqlite3 is built for Node, not Electron — forcing a real rebuild.");
	const markers = findForgeMetaMarkers();
	for (const marker of markers) {
		log(`Removing stale rebuild marker: ${marker}`);
		rmSync(marker);
	}

	run("bun", ["run", "install:deps"]);

	if (!betterSqlite3LoadsUnderElectron()) {
		fail(
			"better-sqlite3 still doesn't load under Electron's ABI after a forced rebuild. " +
				"This needs a C++ toolchain (see root CLAUDE.md 'Native modules' section) — " +
				"check for VS Build Tools / Spectre-mitigated libraries on Windows.",
		);
	}

	log("better-sqlite3 now matches Electron's ABI — done.");
}

main();
