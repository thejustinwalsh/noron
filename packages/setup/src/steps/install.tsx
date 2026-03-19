import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { SetupConfig } from "../generate";
import { runInstall, type InstallStep } from "../installer";

interface InstallProps {
	config: SetupConfig;
	onDone: (needsReboot: boolean, inviteUrl: string | null) => void;
}

const STEP_NAMES = [
	"Installing system packages",
	"Creating system users",
	"Writing configuration",
	"Installing systemd services",
	"Installing helper scripts",
	"Installing dashboard",
	"Configuring boot parameters",
	"Creating bootstrap invite",
	"Starting services",
	"Setting up Tailscale",
];

export function Install({ config, onDone }: InstallProps) {
	const [steps, setSteps] = useState<InstallStep[]>(
		STEP_NAMES.map((name) => ({ name, status: "pending" })),
	);
	const [started, setStarted] = useState(false);

	useEffect(() => {
		if (started) return;
		setStarted(true);

		runInstall(config, (stepName, status, error) => {
			setSteps((prev) =>
				prev.map((s) =>
					s.name === stepName ? { ...s, status, error } : s,
				),
			);
		}).then(({ needsReboot, inviteUrl }) => {
			onDone(needsReboot, inviteUrl);
		});
	}, [started, config, onDone]);

	return (
		<Box flexDirection="column" gap={1}>
			<Text bold>Installing...</Text>

			<Box flexDirection="column" paddingLeft={2}>
				{steps.map((step) => (
					<Box key={step.name}>
						<Box width={3}>
							{step.status === "running" && (
								<Text color="blue">
									<Spinner type="dots" />
								</Text>
							)}
							{step.status === "done" && <Text color="green">✓</Text>}
							{step.status === "error" && <Text color="red">✗</Text>}
							{step.status === "pending" && <Text color="gray">·</Text>}
						</Box>
						<Text
							color={
								step.status === "error"
									? "red"
									: step.status === "done"
										? "green"
										: step.status === "running"
											? "white"
											: "gray"
							}
						>
							{step.name}
						</Text>
						{step.error && (
							<Text color="red"> — {step.error.slice(0, 80)}</Text>
						)}
					</Box>
				))}
			</Box>
		</Box>
	);
}
