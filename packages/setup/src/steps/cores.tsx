import React from "react";
import { Box, Text, useInput } from "ink";
import type { HardwareProfile } from "../detect";
import type { SetupConfig } from "../generate";

interface CoresProps {
	hardware: HardwareProfile;
	config: Partial<SetupConfig>;
	onUpdate: (partial: Partial<SetupConfig>) => void;
	onNext: () => void;
}

export function Cores({ hardware, config, onNext }: CoresProps) {
	useInput((_input, key) => {
		if (key.return) onNext();
	});

	const isolated = config.isolatedCores ?? hardware.cpu.recommendedIsolated;
	const housekeeping = config.housekeepingCore ?? hardware.cpu.recommendedHousekeeping;

	return (
		<Box flexDirection="column" gap={1}>
			<Text bold>CPU Core Allocation</Text>
			<Text color="gray">
				{hardware.cpu.coreCapacities
					? "Strategy: efficiency core for OS, performance cores for benchmarks (big.LITTLE detected)."
					: "Strategy: reserve 1 core for OS, use the rest for benchmarks."}
			</Text>

			<Box flexDirection="column" paddingLeft={2}>
				<Text>
					<Text color="yellow">Housekeeping: </Text>
					<Text>
						Core {housekeeping} (OS, runner, interrupts)
						{hardware.cpu.coreCapacities && (
							<Text color="gray">
								{" "}[{hardware.cpu.coreCapacities.get(housekeeping) === Math.min(...hardware.cpu.coreCapacities.values()) ? "efficiency" : "performance"}]
							</Text>
						)}
					</Text>
				</Text>
				<Text>
					<Text color="green">Isolated: </Text>
					<Text>
						{isolated.length > 0
							? `Cores ${isolated.join(", ")} (benchmarks)`
							: "None — single-core system, no isolation possible"}
						{hardware.cpu.coreCapacities && isolated.length > 0 && (
							<Text color="gray"> [performance]</Text>
						)}
					</Text>
				</Text>
			</Box>

			{hardware.cpu.totalCores < 2 && (
				<Text color="red">
					Warning: Single-core system detected. CPU isolation requires at least 2 cores.
				</Text>
			)}

			<Text color="gray">Press Enter to accept this configuration...</Text>
		</Box>
	);
}
