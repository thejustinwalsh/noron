import React from "react";
import { Box, Text, useInput } from "ink";
import type { SetupConfig } from "../generate";
import { recommendTmpfsSize } from "../generate";

interface ReviewProps {
	config: SetupConfig;
	onConfirm: () => void;
	onBack: () => void;
}

export function Review({ config, onConfirm, onBack }: ReviewProps) {
	useInput((_input, key) => {
		if (key.return) onConfirm();
		if (key.escape) onBack();
	});

	return (
		<Box flexDirection="column" gap={1}>
			<Text bold>Review Configuration</Text>

			<Box flexDirection="column" paddingLeft={2}>
				<Text bold color="blue">CPU Cores</Text>
				<Text>
					<Text color="gray">  Housekeeping: </Text>
					<Text>Core {config.housekeepingCore}</Text>
				</Text>
				<Text>
					<Text color="gray">  Isolated:     </Text>
					<Text>
						{config.isolatedCores.length > 0
							? `Cores ${config.isolatedCores.join(", ")}`
							: "None"}
					</Text>
				</Text>
			</Box>

			<Box flexDirection="column" paddingLeft={2}>
				<Text bold color="blue">GitHub OAuth</Text>
				<Text>
					<Text color="gray">  Client ID: </Text>
					<Text>{config.githubClientId}</Text>
				</Text>
				<Text>
					<Text color="gray">  Secret:    </Text>
					<Text>{config.githubClientSecret.slice(0, 4)}{"****"}</Text>
				</Text>
			</Box>

			<Box flexDirection="column" paddingLeft={2}>
				<Text bold color="blue">Network</Text>
				<Text>
					<Text color="gray">  Hostname:  </Text>
					<Text>{config.hostname}</Text>
				</Text>
				<Text>
					<Text color="gray">  Web Port:  </Text>
					<Text>{config.webPort}</Text>
				</Text>
				<Text>
					<Text color="gray">  Tailscale: </Text>
					<Text>{config.tailscaleAuthKey ? "Enabled" : "Disabled"}</Text>
				</Text>
			</Box>

			<Box flexDirection="column" paddingLeft={2}>
				<Text bold color="blue">Performance</Text>
				<Text>
					<Text color="gray">  Memory:    </Text>
					<Text>{config.totalMemoryMB} MB</Text>
				</Text>
				<Text>
					<Text color="gray">  Tmpfs:     </Text>
					<Text>
						{(() => {
							const size = recommendTmpfsSize(config.totalMemoryMB);
							if (!size) return "Disabled (not enough memory)";
							return `${size.toUpperCase()} at /mnt/bench-tmpfs`;
						})()}
					</Text>
				</Text>
				<Text>
					<Text color="gray">  Governor:  </Text>
					<Text>performance (all cores)</Text>
				</Text>
			</Box>

			<Box flexDirection="column" paddingLeft={2}>
				<Text bold color="blue">Runner</Text>
				<Text>
					<Text color="gray">  Label:     </Text>
					<Text>{config.runnerLabel}</Text>
				</Text>
			</Box>

			<Box flexDirection="column" paddingLeft={2}>
				<Text bold color="blue">Services</Text>
				<Text>
					<Text color="gray">  Dashboard: </Text>
					<Text>http://{config.hostname}:{config.webPort}/dashboard/</Text>
				</Text>
			</Box>

			<Box marginTop={1}>
				<Text color="green">Press Enter to install</Text>
				<Text color="gray"> | </Text>
				<Text color="yellow">Press Escape to go back</Text>
			</Box>
		</Box>
	);
}
