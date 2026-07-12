import { execFileSync } from "node:child_process";

const WSL_DISTRO = "Ubuntu";

/**
 * Checks whether Turnstone's venv is present inside WSL. Collapses three
 * failure modes into one boolean: no WSL at all (also what naturally happens
 * on macOS/Linux — execFileSync throws ENOENT here), WSL present but no
 * Ubuntu distro, or Ubuntu present but the venv/turnstone binary missing.
 *
 * Unlike findRealBinary's near-instant native `where.exe`/`which` check, a
 * cold WSL VM can take a couple of seconds to start, so this gets a generous
 * timeout instead of hanging the availability query indefinitely.
 */
export function checkTurnstoneAvailable(): boolean {
	try {
		execFileSync(
			"wsl.exe",
			[
				"-d",
				WSL_DISTRO,
				"--",
				"bash",
				"-lc",
				"test -x ~/turnstone-venv/bin/turnstone",
			],
			{ stdio: "ignore", timeout: 5_000 },
		);
		return true;
	} catch {
		return false;
	}
}
