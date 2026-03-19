import { DEFAULT_WEB_PORT } from "@noron/shared";
import { Box, Text } from "ink";
import React, { useState } from "react";
import { type HardwareProfile, detectHardware } from "./detect";
import type { SetupConfig } from "./generate";
import { Cores } from "./steps/cores";
import { Done } from "./steps/done";
import { Install } from "./steps/install";
import { Label } from "./steps/label";
import { Network } from "./steps/network";
import { OAuth } from "./steps/oauth";
import { Review } from "./steps/review";
import { Welcome } from "./steps/welcome";

type Step = "welcome" | "cores" | "oauth" | "network" | "label" | "review" | "install" | "done";

export function Wizard() {
	const [step, setStep] = useState<Step>("welcome");
	const [hardware] = useState<HardwareProfile>(() => detectHardware());
	const [config, setConfig] = useState<Partial<SetupConfig>>({
		isolatedCores: hardware.cpu.recommendedIsolated,
		housekeepingCore: hardware.cpu.recommendedHousekeeping,
		webPort: DEFAULT_WEB_PORT,
		hostname: hardware.hostname,
		totalMemoryMB: hardware.memory.totalMB,
		runnerLabel: hardware.hostname || "noron",
	});
	const [needsReboot, setNeedsReboot] = useState(false);
	const [inviteUrl, setInviteUrl] = useState<string | null>(null);

	const updateConfig = (partial: Partial<SetupConfig>) => {
		setConfig((prev) => ({ ...prev, ...partial }));
	};

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={1}>
				<Text bold color="blue">
					Benchmark Appliance Setup
				</Text>
				<Text color="gray"> — Step: {step}</Text>
			</Box>

			{step === "welcome" && <Welcome hardware={hardware} onNext={() => setStep("cores")} />}
			{step === "cores" && (
				<Cores
					hardware={hardware}
					config={config}
					onUpdate={updateConfig}
					onNext={() => setStep("oauth")}
				/>
			)}
			{step === "oauth" && (
				<OAuth config={config} onUpdate={updateConfig} onNext={() => setStep("network")} />
			)}
			{step === "network" && (
				<Network
					hardware={hardware}
					config={config}
					onUpdate={updateConfig}
					onNext={() => setStep("label")}
				/>
			)}
			{step === "label" && (
				<Label config={config} onUpdate={updateConfig} onNext={() => setStep("review")} />
			)}
			{step === "review" && (
				<Review
					config={config as SetupConfig}
					onConfirm={() => setStep("install")}
					onBack={() => setStep("cores")}
				/>
			)}
			{step === "install" && (
				<Install
					config={config as SetupConfig}
					onDone={(reboot, invite) => {
						setNeedsReboot(reboot);
						setInviteUrl(invite);
						setStep("done");
					}}
				/>
			)}
			{step === "done" && (
				<Done config={config as SetupConfig} needsReboot={needsReboot} inviteUrl={inviteUrl} />
			)}
		</Box>
	);
}
