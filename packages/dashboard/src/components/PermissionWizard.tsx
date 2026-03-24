import type WaInputEl from "@awesome.me/webawesome/dist/components/input/input.js";
import { WaButton, WaIcon, WaInput } from "@awesome.me/webawesome/dist/react";
import { useState } from "react";

interface PermissionWizardProps {
	repo?: string;
	onPatSaved: () => void;
}

type Step = "choose" | "pat-input";

export function PermissionWizard({ repo, onPatSaved }: PermissionWizardProps) {
	const [step, setStep] = useState<Step>("choose");
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

			onPatSaved();
		} catch (err) {
			setPatError(err instanceof Error ? err.message : "Failed to save token");
		} finally {
			setSaving(false);
		}
	};

	if (step === "choose") {
		return (
			<div className="onboarding">
				<h2 style={{ margin: 0, fontSize: "20px" }}>Connect to GitHub</h2>
				<p className="muted" style={{ textAlign: "center" }}>
					{repo
						? `We need permission to register a self-hosted runner on ${repo}.`
						: "We need permission to register self-hosted runners on your repositories."}
				</p>
				<div className="onboarding-choices">
					<div
						className="onboarding-choice"
						role="button"
						tabIndex={0}
						onClick={() => {
							window.location.href = "/auth/upgrade";
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter") window.location.href = "/auth/upgrade";
						}}
					>
						<WaIcon
							name="github"
							family="brands"
							style={{ fontSize: "24px", color: "var(--text)" }}
						/>
						<strong>Re-authorize with GitHub</strong>
						<p className="muted" style={{ margin: 0, fontSize: "12px" }}>
							Grants access for repos where you are an admin.
						</p>
					</div>
					<div
						className="onboarding-choice"
						role="button"
						tabIndex={0}
						onClick={() => setStep("pat-input")}
						onKeyDown={(e) => {
							if (e.key === "Enter") setStep("pat-input");
						}}
					>
						<WaIcon
							name="key"
							family="classic"
							variant="solid"
							style={{ fontSize: "24px", color: "var(--yellow)" }}
						/>
						<strong>Use a personal access token</strong>
						<p className="muted" style={{ margin: 0, fontSize: "12px" }}>
							Works for any repo. Use a fine-grained token scoped to specific repos.
						</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="onboarding">
			<h2 style={{ margin: 0, fontSize: "20px" }}>Add a personal access token</h2>
			<div className="onboarding-instructions">
				<p className="muted">Create a fine-grained token on GitHub:</p>
				<ol className="muted" style={{ paddingLeft: "20px", textAlign: "left", lineHeight: "1.8" }}>
					<li>
						Go to{" "}
						<a
							href="https://github.com/settings/tokens?type=beta"
							target="_blank"
							rel="noopener noreferrer"
							style={{ color: "var(--primary)" }}
						>
							github.com/settings/tokens
						</a>{" "}
						&rarr; Fine-grained tokens &rarr; Generate new token
					</li>
					<li>
						Select <strong>"Only select repositories"</strong> &rarr; pick your repo(s)
					</li>
					<li>
						Permissions &rarr; Repository permissions &rarr; <strong>"Administration"</strong>{" "}
						&rarr; Read and write
					</li>
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
			{patError && <p style={{ color: "var(--red)", fontSize: "13px", margin: 0 }}>{patError}</p>}
			<div style={{ display: "flex", gap: "8px" }}>
				<WaButton
					variant="neutral"
					appearance="outlined"
					size="small"
					onClick={() => setStep("choose")}
				>
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
	);
}
