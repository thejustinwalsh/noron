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
import { Password } from "./steps/password";
import { Review } from "./steps/review";
import { Timezone } from "./steps/timezone";
import { Welcome } from "./steps/welcome";

type Step =
	| "welcome"
	| "password"
	| "timezone"
	| "cores"
	| "oauth"
	| "network"
	| "label"
	| "review"
	| "install"
	| "done";

interface WizardProps {
	isFirstRun: boolean;
}

export function Wizard({ isFirstRun }: WizardProps) {
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

	// First run: welcome → password → timezone → cores → ...
	// Reconfigure: welcome → cores → ... (skip password/timezone)
	const afterWelcome = isFirstRun ? "password" : "cores";
	const afterPassword = "timezone";
	const afterTimezone = "cores";

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={1}>
				<Text bold color="blue">
					Noron Benchmark Appliance Setup
				</Text>
				<Text color="gray"> — {step}</Text>
			</Box>

			{step === "welcome" && <Welcome hardware={hardware} onNext={() => setStep(afterWelcome)} />}
			{step === "password" && <Password onNext={() => setStep(afterPassword)} />}
			{step === "timezone" && <Timezone onNext={() => setStep(afterTimezone)} />}
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
					isFirstRun={isFirstRun}
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
