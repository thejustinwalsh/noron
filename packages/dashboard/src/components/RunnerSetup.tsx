import { WaBadge, WaButton, WaIcon } from "@awesome.me/webawesome/dist/react";
import { useCallback, useEffect, useState } from "react";

interface RunnerSetupProps {
	runnerId: string;
	repo: string;
	initialStatus: string;
	onDismiss: () => void;
}

const WORKFLOW_YAML = `name: Benchmark
on: [push]

jobs:
  benchmark:
    runs-on: [self-hosted, benchmark]
    steps:
      - uses: actions/checkout@v4
      - run: ./your-benchmark.sh
`;

const STATUS_LABELS: Record<
	string,
	{ text: string; variant: "neutral" | "warning" | "success" | "danger" }
> = {
	pending: { text: "Pending", variant: "neutral" },
	provisioning: { text: "Provisioning...", variant: "warning" },
	online: { text: "Online", variant: "success" },
	offline: { text: "Offline", variant: "neutral" },
	failed: { text: "Failed", variant: "danger" },
	healing: { text: "Healing...", variant: "warning" },
};

export function RunnerSetup({ runnerId, repo, initialStatus, onDismiss }: RunnerSetupProps) {
	const [status, setStatus] = useState(initialStatus);
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	// Poll for status updates until terminal state
	useEffect(() => {
		if (status === "online" || status === "offline" || status === "failed") return;

		const interval = setInterval(async () => {
			try {
				const res = await fetch(`/api/runners/${runnerId}/status`, {
					credentials: "same-origin",
				});
				if (!res.ok) return;
				const data = (await res.json()) as { status: string; statusMessage?: string | null };
				setStatus(data.status);
				if (data.statusMessage) setStatusMessage(data.statusMessage);
			} catch {
				// ignore polling errors
			}
		}, 3000);

		return () => clearInterval(interval);
	}, [runnerId, status]);

	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText(WORKFLOW_YAML);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, []);

	const statusInfo = STATUS_LABELS[status] ?? STATUS_LABELS.pending;
	const isReady = status === "online";
	const isFailed = status === "failed";

	return (
		<div className="runner-setup">
			<div className="runner-setup-header">
				<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
					<strong>{repo}</strong>
					<WaBadge pill variant={statusInfo.variant}>
						{statusInfo.text}
					</WaBadge>
				</div>
				<WaButton variant="neutral" appearance="plain" size="small" onClick={onDismiss}>
					<WaIcon name="xmark" family="classic" variant="solid" />
				</WaButton>
			</div>

			{isFailed && (
				<div className="runner-setup-progress">
					<p style={{ color: "var(--red)", fontSize: "13px", margin: 0 }}>
						{statusMessage ? `Provisioning failed: ${statusMessage}` : "Provisioning failed."} You
						can remove this runner and try again.
					</p>
				</div>
			)}

			{!isReady && !isFailed && (
				<div className="runner-setup-progress">
					<p className="muted">
						Setting up runner container for <strong>{repo}</strong>... This may take a minute.
					</p>
					<div className="setup-steps">
						<SetupStep label="Get registration token" done={status !== "pending"} />
						<SetupStep
							label="Start container"
							done={status !== "pending" && status !== "provisioning"}
							active={status === "provisioning"}
						/>
						<SetupStep
							label="Register with GitHub"
							done={isReady}
							active={status === "provisioning"}
						/>
					</div>
				</div>
			)}

			{isReady && (
				<>
					<p className="muted" style={{ marginBottom: "8px" }}>
						Add this workflow to <code>.github/workflows/benchmark.yml</code> in your repo:
					</p>
					<div className="setup-code-wrap">
						<pre className="setup-code">{WORKFLOW_YAML}</pre>
						<WaButton
							variant="neutral"
							appearance="outlined"
							size="small"
							onClick={handleCopy}
							style={{ position: "absolute", top: "8px", right: "8px" }}
						>
							<WaIcon
								name={copied ? "check" : "copy"}
								family="classic"
								variant="solid"
								slot="prefix"
							/>
							{copied ? "Copied" : "Copy"}
						</WaButton>
					</div>
					<div className="setup-info">
						<p className="muted">
							<strong>What happens:</strong> Job starts → acquires machine lock → waits for thermal
							stability → runs on isolated CPU cores → releases lock.
						</p>
					</div>
				</>
			)}
		</div>
	);
}

function SetupStep({ label, done, active }: { label: string; done?: boolean; active?: boolean }) {
	return (
		<div className={`setup-step${done ? " done" : ""}${active ? " active" : ""}`}>
			<WaIcon
				name={done ? "circle-check" : "circle"}
				family="classic"
				variant={done ? "solid" : "regular"}
				style={{ fontSize: "14px", color: done ? "var(--green)" : "var(--text-muted)" }}
			/>
			<span>{label}</span>
		</div>
	);
}
