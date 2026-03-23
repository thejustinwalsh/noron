import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import React, { useCallback, useEffect, useState } from "react";
import type { SetupConfig } from "../generate";
import { type InstallStep, getInstallSteps, runInstall } from "../installer";

interface InstallProps {
	config: SetupConfig;
	isFirstRun: boolean;
	onDone: (needsReboot: boolean, inviteUrl: string | null) => void;
}

const MAX_OUTPUT_LINES = 3;

export function Install({ config, isFirstRun, onDone }: InstallProps) {
	const [steps, setSteps] = useState<InstallStep[]>(
		getInstallSteps(config, isFirstRun).map((name) => ({ name, status: "pending" })),
	);
	const [outputLines, setOutputLines] = useState<string[]>([]);
	const [fatalError, setFatalError] = useState<string | null>(null);
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
		).then(({ needsReboot, inviteUrl, fatal }) => {
			if (fatal) {
				setFatalError(fatal);
			} else {
				onDone(needsReboot, inviteUrl);
			}
		});
	}, [started, config, isFirstRun, handleOutput, onDone]);

	return (
		<Box flexDirection="column" gap={1}>
			<Text bold>{fatalError ? "Setup failed" : "Installing..."}</Text>

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
											? "whiteBright"
											: "gray"
							}
						>
							{step.name}
						</Text>
						{step.error && !fatalError && <Text color="red"> — {step.error.slice(0, 80)}</Text>}
					</Box>
				))}
			</Box>

			{fatalError ? (
				<Box flexDirection="column" paddingLeft={2} marginTop={1}>
					<Text color="red" bold>
						Setup cannot continue.
					</Text>
					<Text color="white" dimColor>
						{"\n"}Error details:
					</Text>
					{fatalError.split("\n").map((line, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: error output lines
						<Text key={i} color="white">
							{"  "}
							{line}
						</Text>
					))}
					<Text color="yellow" dimColor>
						{"\n"}Check your network connection and try running: sudo bench-setup --reconfigure
					</Text>
				</Box>
			) : (
				<Box flexDirection="column" paddingLeft={4} marginTop={1} height={MAX_OUTPUT_LINES}>
					{Array.from({ length: MAX_OUTPUT_LINES }, (_, i) => {
						const line = outputLines[i];
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed-size placeholder slots
							<Text key={i} color="white">
								{line ? (line.length > 80 ? `${line.slice(0, 77)}...` : line) : " "}
							</Text>
						);
					})}
				</Box>
			)}
		</Box>
	);
}
