/**
 * Cross-platform postinstall, run on every `bun install`.
 *
 * Replaces scripts/postinstall.sh: bun on Windows can't exec a .sh directly
 * ("command not found: ./scripts/postinstall.sh"), so this is TypeScript that
 * bun runs natively on macOS, Linux, and Windows alike.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";

// electron-builder's install-app-deps can trigger a nested `bun install`, which
// would re-run this postinstall and spawn hundreds of processes. Guard against it.
if (process.env.SUPERSET_POSTINSTALL_RUNNING) {
	process.exit(0);
}

const env = { ...process.env, SUPERSET_POSTINSTALL_RUNNING: "1" };

function run(cmd: string, args: string[], cwd?: string): number {
	// shell:true on Windows so PATH shims (sherif.cmd, bunx.exe) resolve via cmd.exe.
	const { status } = spawnSync(cmd, args, {
		stdio: "inherit",
		env,
		cwd,
		shell: process.platform === "win32",
	});
	return status ?? 1;
}

// Workspace validation — fatal, it catches real dependency drift.
const sherifStatus = run("sherif", []);
if (sherifStatus !== 0) {
	process.exit(sherifStatus);
}

// Rebuild the desktop app's native modules against Electron's ABI, from source.
// This needs a C++ toolchain: Xcode (macOS), gcc (Linux), or VS Build Tools on
// Windows — including the "Spectre-mitigated libs" component that node-pty
// requires. When that's present, every native module compiles.
const rebuildStatus = run("bun", [
	"run",
	"--filter=@ade/desktop",
	"install:deps",
]);

// Fallback for machines without a full C++ toolchain: the source rebuild fails,
// so fetch the Electron prebuilt for better-sqlite3 — the one native module the
// app can't start without (NAN-based / per-ABI). The rest (node-pty, bufferutil,
// utf-8-validate, ...) are N-API and ship Electron-compatible prebuilds, so this
// keeps `bun install` working everywhere without failing the whole install.
// ponytail: better-sqlite3 is currently the sole non-N-API native dep; if another
// is added, ensure it here too.
if (rebuildStatus !== 0) {
	console.warn(
		"[postinstall] Native source rebuild failed (missing C++ build tools?). " +
			"Falling back to the better-sqlite3 Electron prebuilt so the app still runs.",
	);
	try {
		const bs3Dir = dirname(
			Bun.resolveSync(
				"better-sqlite3/package.json",
				`${process.cwd()}/apps/desktop`,
			),
		);
		const electronVersion = (
			JSON.parse(readFileSync("apps/desktop/package.json", "utf8"))
				.devDependencies.electron as string
		).replace(/^\D*/, "");
		const bs3Status = run(
			"bunx",
			[
				"prebuild-install",
				"-r",
				"electron",
				"-t",
				electronVersion,
				"--arch",
				process.arch,
			],
			bs3Dir,
		);
		if (bs3Status !== 0) {
			console.error(
				"[postinstall] Failed to fetch the Electron build of better-sqlite3.",
			);
			process.exit(bs3Status);
		}
	} catch (err) {
		console.error(
			"[postinstall] Could not rebuild better-sqlite3 for Electron:",
			err,
		);
		process.exit(1);
	}
}
