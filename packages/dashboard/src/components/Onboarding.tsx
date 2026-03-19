import { useState } from "react";
import { WaButton, WaCard, WaIcon, WaInput } from "@awesome.me/webawesome/dist/react";
import type WaInputEl from "@awesome.me/webawesome/dist/components/input/input.js";

interface OnboardingProps {
	onComplete: () => void;
}

type Step = "welcome" | "choose" | "pat-input";

export function Onboarding({ onComplete }: OnboardingProps) {
	const [step, setStep] = useState<Step>("welcome");
	const [pat, setPat] = useState("");
	const [patError, setPatError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const handleSavePat = async () => {
		if (!pat.trim()) return;
		setSaving(true);
		setPatError(null);

		try {
			const res = await fetch("/api/auth/pat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "same-origin",
				body: JSON.stringify({ pat: pat.trim() }),
			});

			if (!res.ok) {
				const body = (await res.json()) as { error?: string };
				throw new Error(body.error ?? `${res.status} ${res.statusText}`);
			}

			onComplete();
		} catch (err) {
			setPatError(err instanceof Error ? err.message : "Failed to save token");
		} finally {
			setSaving(false);
		}
	};

	if (step === "welcome") {
		return (
			<WaCard>
				<div className="onboarding">
					<div className="onboarding-icon">
						<WaIcon name="gauge-high" family="classic" variant="solid" style={{ fontSize: "32px", color: "var(--primary)" }} />
					</div>
					<h2 style={{ margin: 0, fontSize: "20px" }}>Welcome to your benchmark appliance</h2>
					<p className="muted" style={{ maxWidth: "480px", textAlign: "center" }}>
						This appliance runs your GitHub Actions benchmarks on dedicated hardware
						with hardware-level CPU isolation for repeatable, low-variance results.
					</p>
					<WaButton variant="brand" onClick={() => setStep("choose")}>
						Get Started
					</WaButton>
				</div>
			</WaCard>
		);
	}

	if (step === "choose") {
		return (
			<WaCard>
				<div className="onboarding">
					<h2 style={{ margin: 0, fontSize: "20px" }}>How would you like to connect?</h2>
					<p className="muted" style={{ textAlign: "center" }}>
						We need access to your repositories to register self-hosted runners.
					</p>
					<div className="onboarding-choices">
						<div className="onboarding-choice" onClick={() => {
							window.location.href = "/auth/upgrade";
						}}>
							<WaIcon name="github" family="brands" style={{ fontSize: "24px", color: "var(--text)" }} />
							<strong>Grant GitHub access</strong>
							<p className="muted" style={{ margin: 0, fontSize: "12px" }}>
								One click to authorize. We'll handle runner provisioning automatically.
							</p>
						</div>
						<div className="onboarding-choice" onClick={() => setStep("pat-input")}>
							<WaIcon name="key" family="classic" variant="solid" style={{ fontSize: "24px", color: "var(--yellow)" }} />
							<strong>Use a personal access token</strong>
							<p className="muted" style={{ margin: 0, fontSize: "12px" }}>
								Full control over what we can access. Use a fine-grained token scoped to specific repos.
							</p>
						</div>
					</div>
				</div>
			</WaCard>
		);
	}

	// pat-input step
	return (
		<WaCard>
			<div className="onboarding">
				<h2 style={{ margin: 0, fontSize: "20px" }}>Add a personal access token</h2>
				<div className="onboarding-instructions">
					<p className="muted">Create a fine-grained token on GitHub:</p>
					<ol className="muted" style={{ paddingLeft: "20px", textAlign: "left", lineHeight: "1.8" }}>
						<li>
							Go to{" "}
							<a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)" }}>
								github.com/settings/tokens
							</a>{" "}
							&rarr; Fine-grained tokens &rarr; Generate new token
						</li>
						<li>Select <strong>"Only select repositories"</strong> &rarr; pick your repo(s)</li>
						<li>Permissions &rarr; Repository permissions &rarr; <strong>"Administration"</strong> &rarr; Read and write</li>
						<li>Copy the generated token and paste it below</li>
					</ol>
				</div>
				<div style={{ width: "100%", maxWidth: "480px" }}>
					<WaInput
						type="password"
						label="Personal access token"
						placeholder="github_pat_..."
						size="small"
						value={pat}
						onInput={(e) => setPat((e.target as unknown as WaInputEl).value ?? "")}
						style={{ width: "100%" }}
					/>
				</div>
				{patError && (
					<p style={{ color: "var(--red)", fontSize: "13px", margin: 0 }}>
						{patError}
					</p>
				)}
				<div style={{ display: "flex", gap: "8px" }}>
					<WaButton variant="neutral" appearance="outlined" size="small" onClick={() => setStep("choose")}>
						Back
					</WaButton>
					<WaButton
						variant="brand"
						size="small"
						loading={saving}
						disabled={!pat.trim()}
						onClick={handleSavePat}
					>
						Save Token
					</WaButton>
				</div>
			</div>
		</WaCard>
	);
}
