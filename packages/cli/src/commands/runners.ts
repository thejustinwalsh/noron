import { Command, Option } from "clipanion";
import { loadConfig, loadCredentials } from "../config";

interface Runner {
	id: string;
	name: string;
	status: string;
	registeredAt: number;
	lastHeartbeat: number | null;
}

export class RunnersCommand extends Command {
	static paths = [["runners"]];
	static usage = Command.Usage({
		description: "List all runners registered to your account",
	});

	server = Option.String("--server", { description: "Server URL override" });

	async execute(): Promise<number> {
		const creds = loadCredentials();
		if (!creds) {
			this.context.stderr.write(
				"Not logged in. Run `bench login --server <url>` first.\n",
			);
			return 1;
		}

		const config = loadConfig();
		const serverUrl = this.server ?? config.serverUrl;
		if (!serverUrl) {
			this.context.stderr.write(
				"No server URL configured. Use --server <url>\n",
			);
			return 1;
		}

		const res = await fetch(`${serverUrl}/api/runners`, {
			headers: {
				Authorization: `Bearer ${creds.githubToken}`,
			},
		});

		if (!res.ok) {
			this.context.stderr.write(`Failed to fetch runners: ${res.statusText}\n`);
			return 1;
		}

		const runners = (await res.json()) as Runner[];

		if (runners.length === 0) {
			this.context.stdout.write("No runners registered.\n");
			return 0;
		}

		this.context.stdout.write("\n  Your Runners\n");
		this.context.stdout.write("  ============\n\n");

		for (const runner of runners) {
			const statusColor =
				runner.status === "online" ? "\x1b[32m" : "\x1b[31m";
			const reset = "\x1b[0m";
			const registered = new Date(runner.registeredAt).toLocaleDateString();
			this.context.stdout.write(
				`  ${runner.name}  ${statusColor}${runner.status}${reset}  (since ${registered})\n`,
			);
		}

		this.context.stdout.write("\n");
		return 0;
	}
}
