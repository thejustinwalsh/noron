import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import React, { useState } from "react";
import type { HardwareProfile } from "../detect";
import type { SetupConfig } from "../generate";

interface NetworkProps {
	hardware: HardwareProfile;
	config: Partial<SetupConfig>;
	onUpdate: (partial: Partial<SetupConfig>) => void;
	onNext: () => void;
}

type Field = "hostname" | "tailscale";

export function Network({ hardware, config, onUpdate, onNext }: NetworkProps) {
	const [field, setField] = useState<Field>("hostname");
	const [hostname, setHostname] = useState(config.hostname ?? hardware.hostname);
	const [tailscaleKey, setTailscaleKey] = useState(config.tailscaleAuthKey ?? "");

	const handleSubmitHostname = (value: string) => {
		setHostname(value);
		setField("tailscale");
	};

	const handleSubmitTailscale = (value: string) => {
		setTailscaleKey(value);
		onUpdate({
			hostname,
			tailscaleAuthKey: value || undefined,
		});
		onNext();
	};

	return (
		<Box flexDirection="column" gap={1}>
			<Text bold>Network Configuration</Text>

			{hardware.network.length > 0 && (
				<Box flexDirection="column" paddingLeft={2}>
					<Text color="gray">Detected interfaces:</Text>
					{hardware.network.map((iface) => (
						<Text key={iface.name}>
							{"  "}
							<Text color="yellow">{iface.name}</Text>
							<Text color="gray"> — {iface.address}</Text>
						</Text>
					))}
				</Box>
			)}

			<Box flexDirection="column" paddingLeft={2}>
				<Box>
					<Text color={field === "hostname" ? "green" : "gray"}>Hostname: </Text>
					{field === "hostname" ? (
						<TextInput value={hostname} onChange={setHostname} onSubmit={handleSubmitHostname} />
					) : (
						<Text>{hostname}</Text>
					)}
				</Box>
				<Box marginTop={1}>
					<Text color={field === "tailscale" ? "green" : "gray"}>Tailscale Auth Key: </Text>
					{field === "tailscale" ? (
						<TextInput
							value={tailscaleKey}
							onChange={setTailscaleKey}
							onSubmit={handleSubmitTailscale}
							placeholder="(optional, press Enter to skip)"
						/>
					) : (
						<Text color="gray">{"(complete hostname first)"}</Text>
					)}
				</Box>
			</Box>

			{field === "tailscale" && (
				<Text color="gray">
					Tailscale provides secure mesh VPN. Leave blank to skip. Press Enter to continue...
				</Text>
			)}
		</Box>
	);
}
