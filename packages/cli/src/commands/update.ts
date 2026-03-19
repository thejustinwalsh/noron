import { Command, Option } from "clipanion";
import { loadConfig, loadCredentials } from "../config";

export class UpdateStatusCommand extends Command {
	static paths = [["update"], ["update", "status"]];
	static usage = Command.Usage({
		description: "Show current version and update status",
	});

	async execute(): Promise<number> {
		const config = loadConfig();
		const creds = loadCredentials();
		const baseUrl = config.serverUrl ?? "http://localhost:9216";

		try {
			const res = await fetch(`${baseUrl}/api/update/status`, {
				headers: creds ? { Authorization: `Bearer ${creds.githubToken}` } : {},
			});

			if (!res.ok) {
				this.context.stderr.write(`Failed to fetch update status: ${res.status}\n`);
				return 1;
			}

			const data = (await res.json()) as {
				currentVersion: string;
				updateRepo: string | null;
				autoUpdate: boolean;
				latest: {
					version: string;
					state: string;
					startedAt: number | null;
					completedAt: number | null;
					error: string | null;
				} | null;
			};

			this.context.stdout.write("\n  Update Status\n");
			this.context.stdout.write("  =============\n\n");
			this.context.stdout.write(`  Current version: ${data.currentVersion}\n`);
			this.context.stdout.write(`  Update repo:     ${data.updateRepo ?? "not configured"}\n`);
			this.context.stdout.write(`  Auto-update:     ${data.autoUpdate ? "enabled" : "disabled"}\n`);

			if (data.latest) {
				const stateColor =
					data.latest.state === "completed"
						? "\x1b[32m"
						: data.latest.state === "rolled_back" || data.latest.state === "failed"
							? "\x1b[31m"
							: "\x1b[33m";
				const reset = "\x1b[0m";
				this.context.stdout.write(`\n  Latest update:   ${data.latest.version} (${stateColor}${data.latest.state}${reset})\n`);
				if (data.latest.error) {
					this.context.stdout.write(`  Error:           ${data.latest.error}\n`);
				}
			}

			this.context.stdout.write("\n");
			return 0;
		} catch (err) {
			this.context.stderr.write(`Cannot connect to bench-web at ${baseUrl}\n`);
			return 1;
		}
	}
}

export class UpdateCheckCommand extends Command {
	static paths = [["update", "check"]];
	static usage = Command.Usage({
		description: "Check for available updates",
	});

	async execute(): Promise<number> {
		const config = loadConfig();
		const creds = loadCredentials();
		const baseUrl = config.serverUrl ?? "http://localhost:9216";

		try {
			const res = await fetch(`${baseUrl}/api/update/check`, {
				method: "POST",
				headers: creds ? { Authorization: `Bearer ${creds.githubToken}` } : {},
			});

			if (!res.ok) {
				this.context.stderr.write(`Check failed: ${res.status}\n`);
				return 1;
			}

			const data = (await res.json()) as {
				checked: boolean;
				currentVersion: string;
				latest: { version: string; state: string } | null;
			};

			if (data.latest && data.latest.state === "pending") {
				this.context.stdout.write(`Update available: ${data.currentVersion} → ${data.latest.version}\n`);
			} else {
				this.context.stdout.write(`Up to date (${data.currentVersion})\n`);
			}

			return 0;
		} catch {
			this.context.stderr.write(`Cannot connect to bench-web at ${baseUrl}\n`);
			return 1;
		}
	}
}

export class UpdateApplyCommand extends Command {
	static paths = [["update", "apply"]];
	static usage = Command.Usage({
		description: "Apply available update now",
	});

	async execute(): Promise<number> {
		const config = loadConfig();
		const creds = loadCredentials();
		const baseUrl = config.serverUrl ?? "http://localhost:9216";

		try {
			const res = await fetch(`${baseUrl}/api/update/apply`, {
				method: "POST",
				headers: creds ? { Authorization: `Bearer ${creds.githubToken}` } : {},
			});

			if (!res.ok) {
				this.context.stderr.write(`Apply failed: ${res.status}\n`);
				return 1;
			}

			const data = (await res.json()) as {
				message: string;
				version?: string;
				state?: string;
			};

			this.context.stdout.write(`${data.message}\n`);
			if (data.version) {
				this.context.stdout.write(`Version: ${data.version} (${data.state})\n`);
			}

			return 0;
		} catch {
			this.context.stderr.write(`Cannot connect to bench-web at ${baseUrl}\n`);
			return 1;
		}
	}
}

export class UpdateHistoryCommand extends Command {
	static paths = [["update", "history"]];
	static usage = Command.Usage({
		description: "Show update history",
	});

	async execute(): Promise<number> {
		const config = loadConfig();
		const creds = loadCredentials();
		const baseUrl = config.serverUrl ?? "http://localhost:9216";

		try {
			const res = await fetch(`${baseUrl}/api/update/history`, {
				headers: creds ? { Authorization: `Bearer ${creds.githubToken}` } : {},
			});

			if (!res.ok) {
				this.context.stderr.write(`Failed: ${res.status}\n`);
				return 1;
			}

			const data = (await res.json()) as {
				currentVersion: string;
				updates: {
					version: string;
					state: string;
					startedAt: number | null;
					completedAt: number | null;
					error: string | null;
				}[];
			};

			this.context.stdout.write(`\n  Current: ${data.currentVersion}\n\n`);

			if (data.updates.length === 0) {
				this.context.stdout.write("  No update history\n\n");
				return 0;
			}

			for (const u of data.updates) {
				const date = u.startedAt ? new Date(u.startedAt).toISOString().slice(0, 16) : "?";
				const stateColor =
					u.state === "completed"
						? "\x1b[32m"
						: u.state === "rolled_back" || u.state === "failed"
							? "\x1b[31m"
							: "\x1b[33m";
				const reset = "\x1b[0m";
				this.context.stdout.write(`  ${date}  ${u.version}  ${stateColor}${u.state}${reset}\n`);
				if (u.error) {
					this.context.stdout.write(`             ${u.error}\n`);
				}
			}
			this.context.stdout.write("\n");

			return 0;
		} catch {
			this.context.stderr.write(`Cannot connect to bench-web at ${baseUrl}\n`);
			return 1;
		}
	}
}
