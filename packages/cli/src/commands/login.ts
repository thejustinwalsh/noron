import { Command, Option } from "clipanion";
import { loadConfig, saveCredentials } from "../config";

export class LoginCommand extends Command {
	static paths = [["login"]];
	static usage = Command.Usage({
		description: "Authenticate with the benchmark service via GitHub",
	});

	server = Option.String("--server", { description: "Server URL override" });

	async execute(): Promise<number> {
		const config = loadConfig();
		const serverUrl = this.server ?? config.serverUrl;

		if (!serverUrl) {
			this.context.stderr.write(
				"No server URL configured. Use --server <url> or set serverUrl in ~/.config/bench/config.json\n",
			);
			return 1;
		}

		// Step 1: Request device code
		this.context.stdout.write("Requesting device authorization...\n");

		const deviceRes = await fetch(`${serverUrl}/auth/device`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
		});

		if (!deviceRes.ok) {
			this.context.stderr.write(`Failed to request device code: ${deviceRes.statusText}\n`);
			return 1;
		}

		const { deviceCode, userCode, verificationUri } = (await deviceRes.json()) as {
			deviceCode: string;
			userCode: string;
			verificationUri: string;
		};

		this.context.stdout.write(`\nOpen this URL in your browser:\n  ${verificationUri}\n\n`);
		this.context.stdout.write(`Enter code: ${userCode}\n\n`);
		this.context.stdout.write("Waiting for authorization...\n");

		// Step 2: Poll for token
		const pollInterval = 5000;
		const maxAttempts = 60; // 5 minutes

		for (let i = 0; i < maxAttempts; i++) {
			await new Promise((r) => setTimeout(r, pollInterval));

			const pollRes = await fetch(`${serverUrl}/auth/device/poll`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ deviceCode }),
			});

			if (!pollRes.ok) continue;

			const data = (await pollRes.json()) as {
				status: string;
				token?: string;
				login?: string;
			};

			if (data.status === "complete" && data.token && data.login) {
				saveCredentials({
					githubToken: data.token,
					githubLogin: data.login,
				});
				this.context.stdout.write(`\nLogged in as ${data.login}\n`);
				return 0;
			}

			if (data.status === "expired") {
				this.context.stderr.write("\nDevice code expired. Please try again.\n");
				return 1;
			}
		}

		this.context.stderr.write("\nAuthorization timed out. Please try again.\n");
		return 1;
	}
}
