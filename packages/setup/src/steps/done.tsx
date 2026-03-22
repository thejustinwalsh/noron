import { execSync } from "node:child_process";
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";
import type { SetupConfig } from "../generate";

interface DoneProps {
	config: SetupConfig;
	needsReboot: boolean;
	inviteUrl: string | null;
}

export function Done({ config, needsReboot, inviteUrl }: DoneProps) {
	const [awaitingReboot, setAwaitingReboot] = useState(false);

	useInput((input, key) => {
		if (!awaitingReboot && key.return) {
			setAwaitingReboot(true);
			return;
		}
		if (awaitingReboot) {
			if (input === "y" || input === "Y") {
				execSync("reboot");
			} else {
				process.exit(0);
			}
		}
	});

	const dashboardUrl = `http://${config.hostname}:${config.webPort}/dashboard/`;

	return (
		<Box flexDirection="column" gap={1}>
			<Text bold color="green">
				Setup Complete!
			</Text>

			<Box flexDirection="column" paddingLeft={2}>
				<Text>
					<Text color="gray">Dashboard: </Text>
					<Text bold color="blue">
						{dashboardUrl}
					</Text>
				</Text>
				<Text>
					<Text color="gray">Config: </Text>
					<Text>/etc/benchd/config.toml</Text>
				</Text>
				<Text>
					<Text color="gray">Logs: </Text>
					<Text>journalctl -u benchd -f</Text>
				</Text>
			</Box>

			{inviteUrl && (
				<Box flexDirection="column" paddingLeft={2}>
					<Text bold color="yellow">
						Admin Invite (expires in 7 days):
					</Text>
					<Text bold color="cyan">
						{inviteUrl}
					</Text>
					<Text color="gray">Open this URL to register as the first admin via GitHub.</Text>
				</Box>
			)}

			<Box flexDirection="column" paddingLeft={2}>
				<Text bold>Next steps:</Text>
				<Text> 1. Open the admin invite URL above</Text>
				<Text> 2. Sign in with GitHub to become the first admin</Text>
				<Text> 3. Generate invite links for your team</Text>
				<Text> 4. Team members register repos for benchmarking</Text>
			</Box>

			{awaitingReboot ? (
				<Text bold color="yellow">
					Reboot now? (y/n)
				</Text>
			) : (
				<Text color="gray">Press Enter to continue...</Text>
			)}
		</Box>
	);
}
