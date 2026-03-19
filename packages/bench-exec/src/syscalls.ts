/**
 * Pin the current process to the specified CPU cores using taskset.
 *
 * @param cores - Array of logical CPU core indices (e.g. [1, 2, 3])
 * @throws If taskset fails (e.g. invalid core IDs or insufficient permissions)
 */
export function applyCpuAffinity(cores: number[]): void {
	if (cores.length === 0) {
		throw new Error("applyCpuAffinity: at least one core must be specified");
	}

	const pid = process.pid;
	const coreList = cores.join(",");

	const result = Bun.spawnSync(["taskset", "-cp", coreList, String(pid)]);

	if (result.exitCode !== 0) {
		const stderr = result.stderr.toString().trim();
		throw new Error(
			`Failed to set CPU affinity to cores [${coreList}] for PID ${pid}: ${stderr || `exit code ${result.exitCode}`}`,
		);
	}
}

/**
 * Apply a nice priority value to the current process.
 *
 * Note: nice values cannot be applied to a running process via the `nice` command;
 * the `nice` command only sets priority for a newly spawned process. For the current
 * process, we use `renice`. The actual benchmark command will also be spawned with
 * the inherited priority.
 *
 * @param priority - Nice value from -20 (highest) to 19 (lowest)
 * @throws If renice fails (e.g. insufficient permissions for negative values)
 */
export function applyNice(priority: number): void {
	if (priority < -20 || priority > 19) {
		throw new Error(
			`applyNice: priority must be between -20 and 19, got ${priority}`,
		);
	}

	const pid = process.pid;

	const result = Bun.spawnSync([
		"renice",
		"-n",
		String(priority),
		"-p",
		String(pid),
	]);

	if (result.exitCode !== 0) {
		const stderr = result.stderr.toString().trim();
		throw new Error(
			`Failed to set nice priority to ${priority} for PID ${pid}: ${stderr || `exit code ${result.exitCode}`}`,
		);
	}
}

/**
 * Set the I/O scheduling class for the current process using ionice.
 *
 * @param classId - I/O scheduling class:
 *   0 = none (use default CFQ behavior)
 *   1 = realtime (highest priority, use with caution)
 *   2 = best-effort (default)
 *   3 = idle (only when no other I/O pending)
 * @throws If ionice fails (e.g. insufficient permissions for realtime class)
 */
export function applyIonice(classId: number): void {
	if (classId < 0 || classId > 3) {
		throw new Error(
			`applyIonice: classId must be between 0 and 3, got ${classId}`,
		);
	}

	const pid = process.pid;

	const result = Bun.spawnSync([
		"ionice",
		"-c",
		String(classId),
		"-p",
		String(pid),
	]);

	if (result.exitCode !== 0) {
		const stderr = result.stderr.toString().trim();
		throw new Error(
			`Failed to set I/O scheduling class to ${classId} for PID ${pid}: ${stderr || `exit code ${result.exitCode}`}`,
		);
	}
}

/**
 * Drop root privileges by switching to the original invoking user.
 *
 * Reads SUDO_UID and SUDO_GID from environment variables (set by sudo)
 * and calls process.setgid() then process.setuid() to drop privileges.
 *
 * IMPORTANT: setgid must be called before setuid, because once we drop
 * to a non-root UID we can no longer change the GID.
 *
 * @throws If SUDO_UID/SUDO_GID are not set or if setuid/setgid fails
 */
export function dropPrivileges(): void {
	const sudoUid = process.env.SUDO_UID;
	const sudoGid = process.env.SUDO_GID;

	if (!sudoUid || !sudoGid) {
		throw new Error(
			"dropPrivileges: SUDO_UID and SUDO_GID must be set in environment. " +
				"This binary must be invoked via sudo.",
		);
	}

	const uid = parseInt(sudoUid, 10);
	const gid = parseInt(sudoGid, 10);

	if (Number.isNaN(uid) || uid < 0) {
		throw new Error(`dropPrivileges: invalid SUDO_UID: ${sudoUid}`);
	}
	if (Number.isNaN(gid) || gid < 0) {
		throw new Error(`dropPrivileges: invalid SUDO_GID: ${sudoGid}`);
	}

	// Order matters: setgid first, then setuid — once UID is non-root,
	// we lose permission to change GID.
	if (!process.setgid || !process.setuid) {
		throw new Error("dropPrivileges: process.setgid/setuid not available on this platform");
	}

	try {
		process.setgid(gid);
	} catch (err) {
		throw new Error(
			`dropPrivileges: failed to setgid(${gid}): ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	try {
		process.setuid(uid);
	} catch (err) {
		throw new Error(
			`dropPrivileges: failed to setuid(${uid}): ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	// Verify we actually dropped
	if (process.getuid?.() === 0) {
		throw new Error(
			"dropPrivileges: still running as root after setuid — this should not happen",
		);
	}
}
