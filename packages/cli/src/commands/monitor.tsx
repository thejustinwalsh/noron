import { BenchdClient, SOCKET_PATH } from "@noron/shared";
import type { StatusUpdate } from "@noron/shared";
import { Command, Option } from "clipanion";
import { Box, Text, render } from "ink";
import React, { useState, useEffect } from "react";

// --- Ink Components ---

function ThermalGraph({
	history,
	current,
	trend,
}: {
	history: number[];
	current: number;
	trend: string;
}) {
	const blocks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
	const min = Math.min(...history, 20);
	const max = Math.max(...history, 80);
	const range = max - min || 1;

	// Take last 60 readings (1 minute at 1Hz)
	const visible = history.slice(-60);
	const sparkline = visible
		.map((t) => {
			const idx = Math.round(((t - min) / range) * (blocks.length - 1));
			return blocks[Math.max(0, Math.min(blocks.length - 1, idx))];
		})
		.join("");

	const color = current < 40 ? "green" : current < 50 ? "yellow" : "red";

	return (
		<Box flexDirection="column">
			<Text bold> Temperature</Text>
			<Text color={color}>
				{" "}
				{current.toFixed(1)}°C ({trend})
			</Text>
			<Text dimColor> {sparkline}</Text>
		</Box>
	);
}

function LockStatus({
	holder,
	queueDepth,
}: {
	holder: StatusUpdate["lock"];
	queueDepth: number;
}) {
	if (!holder) {
		return (
			<Box flexDirection="column">
				<Text bold> Lock</Text>
				<Text color="green"> IDLE — ready for benchmarks</Text>
			</Box>
		);
	}

	const dur = (holder.duration / 1000).toFixed(0);
	return (
		<Box flexDirection="column">
			<Text bold> Lock</Text>
			<Text color="yellow"> HELD by {holder.owner}</Text>
			<Text>
				{" "}
				Job: {holder.jobId} ({dur}s)
			</Text>
			{queueDepth > 0 && <Text> Queue: {queueDepth} waiting</Text>}
		</Box>
	);
}

function Dashboard({ socketPath }: { socketPath: string }) {
	const [status, setStatus] = useState<StatusUpdate | null>(null);
	const [history, setHistory] = useState<number[]>([]);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const client = new BenchdClient(socketPath);

		client
			.connect()
			.then(() => {
				client.subscribe((update) => {
					setStatus(update);
					setHistory((prev) => {
						const next = [...prev, update.thermal.currentTemp];
						return next.slice(-300); // Keep 5 min history
					});
				});
			})
			.catch((err) => {
				setError(`Cannot connect to benchd: ${err.message}`);
			});

		return () => client.close();
	}, [socketPath]);

	if (error) {
		return <Text color="red">{error}</Text>;
	}

	if (!status) {
		return <Text dimColor>Connecting to benchd...</Text>;
	}

	const uptime = (status.uptime / 1000 / 60).toFixed(0);

	return (
		<Box flexDirection="column" padding={1}>
			<Text bold inverse>
				{" "}
				bench monitor{" "}
			</Text>
			<Text dimColor> Uptime: {uptime}m</Text>
			<Text> </Text>
			<ThermalGraph
				history={history}
				current={status.thermal.currentTemp}
				trend={status.thermal.trend}
			/>
			<Text> </Text>
			<LockStatus holder={status.lock} queueDepth={status.queueDepth} />
		</Box>
	);
}

// --- Command ---

export class MonitorCommand extends Command {
	static paths = [["monitor"]];
	static usage = Command.Usage({
		description: "Live TUI dashboard for benchmark daemon monitoring",
	});

	socket = Option.String("--socket", {
		description: "benchd socket path override",
	});

	async execute(): Promise<number> {
		const socketPath = this.socket ?? SOCKET_PATH;
		const { waitUntilExit } = render(React.createElement(Dashboard, { socketPath }));
		await waitUntilExit();
		return 0;
	}
}
