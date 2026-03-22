import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import React, { useCallback, useEffect, useState } from "react";
import type { SetupConfig } from "../generate";
import { type InstallStep, runInstall } from "../installer";

interface InstallProps {
	config: SetupConfig;
	isFirstRun: boolean;
	onDone: (needsReboot: boolean, inviteUrl: string | null) => void;
}

const MAX_OUTPUT_LINES = 3;

const STEP_NAMES = [
	"Installing system packages",
	"Configuring thermal sensors",
	"Disabling irqbalance",
	"Creating system users",
	"Writing configuration",
	"Installing systemd services",
	"Installing helper scripts",
	"Installing dashboard",
	"Installing runner infrastructure",
	"Configuring boot parameters",
	"Creating bootstrap invite",
	"Starting services",
	"Setting up Tailscale",
];

export function Install({ config, isFirstRun, onDone }: InstallProps) {
	const [steps, setSteps] = useState<InstallStep[]>(
		STEP_NAMES.map((name) => ({ name, status: "pending" })),
	);
	const [outputLines, setOutputLines] = useState<string[]>([]);
	const [started, setStarted] = useState(false);

	const handleOutput = useCallback((line: string) => {
		if (!line) return;
		setOutputLines((prev) => {
			const next = [...prev, line];
			return next.length > MAX_OUTPUT_LINES ? next.slice(-MAX_OUTPUT_LINES) : next;
		});
	}, []);

	useEffect(() => {
		if (started) return;
		setStarted(true);

		runInstall(
			config,
			(stepName, status, error) => {
				setSteps((prev) => prev.map((s) => (s.name === stepName ? { ...s, status, error } : s)));
				if (status === "running") {
					setOutputLines([]);
				}
			},
			{ isFirstRun, onOutput: handleOutput },
		).then(({ needsReboot, inviteUrl }) => {
			onDone(needsReboot, inviteUrl);
		});
	}, [started, config, isFirstRun, handleOutput, onDone]);

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
						{step.error && <Text color="red"> — {step.error.slice(0, 80)}</Text>}
					</Box>
				))}
			</Box>

			<Box flexDirection="column" paddingLeft={4} marginTop={1} height={MAX_OUTPUT_LINES}>
				{Array.from({ length: MAX_OUTPUT_LINES }, (_, i) => {
					const line = outputLines[i];
					return (
						// biome-ignore lint/suspicious/noArrayIndexKey: fixed-size placeholder slots
						<Text key={i} color="gray" dimColor>
							{line ? (line.length > 80 ? `${line.slice(0, 77)}...` : line) : " "}
						</Text>
					);
				})}
			</Box>
		</Box>
	);
}
