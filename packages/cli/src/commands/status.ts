import { BenchdClient, SOCKET_PATH } from "@noron/shared";
import { Command, Option } from "clipanion";

export class StatusCommand extends Command {
	static paths = [["status"]];
	static usage = Command.Usage({
		description: "Show current benchmark daemon status",
	});

	socket = Option.String("--socket", {
		description: "benchd socket path override",
	});

	async execute(): Promise<number> {
		const socketPath = this.socket ?? SOCKET_PATH;
		const client = new BenchdClient(socketPath);

		try {
			await client.connect();
		} catch {
			this.context.stderr.write(`Cannot connect to benchd at ${socketPath}\n`);
			return 1;
		}

		try {
			// Get lock status
			const lockStatus = await client.request({
				type: "lock.status",
				requestId: crypto.randomUUID(),
			});

			// Get thermal status
			const thermalStatus = await client.request({
				type: "thermal.status",
				requestId: crypto.randomUUID(),
			});

			this.context.stdout.write("\n  Benchmark Daemon Status\n");
			this.context.stdout.write("  =======================\n\n");

			// Thermal
			if (thermalStatus.type === "thermal.status") {
				const temp = thermalStatus.currentTemp;
				const color = temp < 40 ? "\x1b[32m" : temp < 50 ? "\x1b[33m" : "\x1b[31m";
				const reset = "\x1b[0m";
				this.context.stdout.write(
					`  Temperature: ${color}${temp.toFixed(1)}°C${reset} (${thermalStatus.trend})\n`,
				);
			}

			// Lock
			if (lockStatus.type === "lock.status") {
				if (lockStatus.held && lockStatus.holder) {
					const h = lockStatus.holder;
					const dur = (h.duration / 1000).toFixed(0);
					this.context.stdout.write(
						`  Lock: \x1b[33mHELD\x1b[0m by ${h.owner} (job: ${h.jobId}, ${dur}s)\n`,
					);
				} else {
					this.context.stdout.write("  Lock: \x1b[32mIDLE\x1b[0m\n");
				}
				if (lockStatus.queueDepth > 0) {
					this.context.stdout.write(`  Queue: ${lockStatus.queueDepth} waiting\n`);
				}
			}

			this.context.stdout.write("\n");
			return 0;
		} finally {
			client.close();
		}
	}
}
