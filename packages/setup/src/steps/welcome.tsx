import { Box, Text, useInput } from "ink";
import React from "react";
import type { HardwareProfile } from "../detect";

interface WelcomeProps {
	hardware: HardwareProfile;
	onNext: () => void;
}

export function Welcome({ hardware, onNext }: WelcomeProps) {
	useInput((_input, key) => {
		if (key.return) onNext();
	});

	return (
		<Box flexDirection="column" gap={1}>
			<Text>Detected hardware:</Text>
			<Box flexDirection="column" paddingLeft={2}>
				<Text>
					<Text color="gray">Platform: </Text>
					<Text bold>{hardware.platform}</Text>
				</Text>
				<Text>
					<Text color="gray">CPU Cores: </Text>
					<Text bold>{hardware.cpu.totalCores}</Text>
					<Text color="gray"> (online: {hardware.cpu.onlineCores.join(", ")})</Text>
				</Text>
				<Text>
					<Text color="gray">Memory: </Text>
					<Text bold>{hardware.memory.totalMB} MB</Text>
				</Text>
				{hardware.cpu.coreCapacities && (
					<Text>
						<Text color="gray">Core Types: </Text>
						<Text bold>
							{(() => {
								const caps = hardware.cpu.coreCapacities;
								const maxCap = Math.max(...caps.values());
								const minCap = Math.min(...caps.values());
								const perfCores = hardware.cpu.onlineCores.filter((c) => caps.get(c) === maxCap);
								const effCores = hardware.cpu.onlineCores.filter((c) => caps.get(c) === minCap);
								return `Performance cores: ${perfCores.join(", ")}, Efficiency cores: ${effCores.join(", ")}`;
							})()}
						</Text>
					</Text>
				)}
				<Text>
					<Text color="gray">Thermal Zones: </Text>
					<Text>
						{hardware.cpu.thermalZones.length > 0
							? hardware.cpu.thermalZones.map((z) => z.type).join(", ")
							: "none detected"}
					</Text>
				</Text>
				<Text>
					<Text color="gray">Network: </Text>
					<Text>
						{hardware.network.length > 0
							? hardware.network.map((n) => `${n.name} (${n.address})`).join(", ")
							: "none detected"}
					</Text>
				</Text>
			</Box>
			<Text color="gray">Press Enter to continue...</Text>
		</Box>
	);
}
