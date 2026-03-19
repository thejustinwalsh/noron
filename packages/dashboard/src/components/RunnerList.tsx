import type WaInputEl from "@awesome.me/webawesome/dist/components/input/input.js";
import {
	WaBadge,
	WaButton,
	WaCard,
	WaIcon,
	WaInput,
	WaSpinner,
} from "@awesome.me/webawesome/dist/react";
import { useEffect, useState } from "react";
import { useRunners } from "../hooks/useApi";
import { RepoCombobox } from "./RepoCombobox";
import { RunnerSetup } from "./RunnerSetup";

const STATUS_VARIANT: Record<string, "success" | "warning" | "neutral" | "danger"> = {
	online: "success",
	busy: "warning",
	offline: "neutral",
	pending: "neutral",
	provisioning: "warning",
	removing: "danger",
	failed: "danger",
	healing: "warning",
	disabled: "danger",
};

export function RunnerList({
	hasRepoScope,
	autoAdd,
	onAutoAddConsumed,
}: { hasRepoScope?: boolean; autoAdd?: boolean; onAutoAddConsumed?: () => void }) {
	const { runners, loading, refetch, registerRunner, removeRunner } = useRunners();
	const [showForm, setShowForm] = useState(false);
	const [name, setName] = useState("");
	const [repo, setRepo] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Track which runner was just registered (show setup panel)
	const [setupRunner, setSetupRunner] = useState<{
		id: string;
		repo: string;
		status: string;
	} | null>(null);

	// Auto-open form when redirected from OAuth upgrade (onboarding continuation)
	useEffect(() => {
		if (autoAdd) {
			setShowForm(true);
			onAutoAddConsumed?.();
		}
	}, [autoAdd, onAutoAddConsumed]);

	const handleSubmit = async () => {
		if (!name.trim() || !repo.trim()) return;
		setSubmitting(true);
		setError(null);
		try {
			const runner = await registerRunner.mutateAsync({ name: name.trim(), repo: repo.trim() });
			setSetupRunner({ id: runner.id, repo: runner.repo, status: runner.status });
			setName("");
			setRepo("");
			setShowForm(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to register runner");
		} finally {
			setSubmitting(false);
		}
	};

	const handleRemove = async (id: string) => {
		try {
			await removeRunner.mutateAsync(id);
			if (setupRunner?.id === id) setSetupRunner(null);
		} catch {
			refetch();
		}
	};

	const handleRepoSelect = (fullName: string) => {
		// Auto-populate name from repo name (e.g. "owner/my-repo" → "my-repo")
		const repoName = fullName.split("/").pop() ?? fullName;
		if (!name.trim()) {
			setName(repoName);
		}
	};

	return (
		<WaCard>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					marginBottom: "12px",
				}}
			>
				<h3>
					<WaIcon
						name="person-running"
						family="classic"
						variant="solid"
						style={{ marginRight: "6px" }}
					/>
					Runners
				</h3>
				<div style={{ display: "flex", gap: "8px" }}>
					<WaButton variant="neutral" appearance="outlined" size="small" onClick={() => refetch()}>
						Refresh
					</WaButton>
					<WaButton variant="brand" size="small" onClick={() => setShowForm(!showForm)}>
						{showForm ? "Cancel" : "Add Runner"}
					</WaButton>
				</div>
			</div>

			{showForm && (
				<div className="runner-form">
					<RepoCombobox
						value={repo}
						onChange={setRepo}
						onSelect={handleRepoSelect}
						hasRepoScope={hasRepoScope}
					/>
					<WaInput
						label="Name"
						placeholder="my-benchmark-runner"
						size="small"
						value={name}
						onInput={(e) => setName((e.target as unknown as WaInputEl).value ?? "")}
					/>
					{error && <p style={{ color: "var(--red)", fontSize: "13px", margin: 0 }}>{error}</p>}
					<WaButton
						variant="brand"
						size="small"
						loading={submitting}
						disabled={submitting || !name.trim() || !repo.trim()}
						onClick={handleSubmit}
					>
						Register
					</WaButton>
				</div>
			)}

			{setupRunner && (
				<RunnerSetup
					runnerId={setupRunner.id}
					repo={setupRunner.repo}
					initialStatus={setupRunner.status}
					onDismiss={() => {
						setSetupRunner(null);
						refetch();
					}}
				/>
			)}

			{loading && (
				<div style={{ display: "flex", justifyContent: "center", padding: "24px" }}>
					<WaSpinner />
				</div>
			)}
			{!loading && runners.length === 0 && !showForm && !setupRunner && (
				<p className="muted">No runners registered. Click "Add Runner" to bind a repository.</p>
			)}
			{runners.length > 0 && (
				<div className="runner-list">
					{runners.map((runner) => (
						<div key={runner.id} className="runner-item">
							<div className="runner-name">{runner.name}</div>
							<div className="runner-repo">{runner.repo}</div>
							<WaBadge pill variant={STATUS_VARIANT[runner.status] ?? "neutral"}>
								{runner.status}
							</WaBadge>
							{runner.violationCount > 0 && (
								<WaBadge
									pill
									variant={runner.violationCount >= 3 ? "danger" : "warning"}
									title={`${runner.violationCount} violation(s) in the last 30 days`}
								>
									{runner.violationCount}/3 strikes
								</WaBadge>
							)}
							{runner.job_timeout_ms != null && (
								<WaBadge pill variant="neutral" title="Custom job timeout">
									{Math.round(runner.job_timeout_ms / 60_000)}m timeout
								</WaBadge>
							)}
							{runner.disabled_reason && (
								<span className="muted" style={{ fontSize: "12px" }}>
									{runner.disabled_reason}
								</span>
							)}
							{runner.status === "online" && (
								<WaButton
									variant="neutral"
									appearance="plain"
									size="small"
									onClick={() =>
										setSetupRunner({ id: runner.id, repo: runner.repo, status: runner.status })
									}
									title="Show setup instructions"
								>
									<WaIcon name="gear" family="classic" variant="solid" />
								</WaButton>
							)}
							<WaButton
								variant="neutral"
								appearance="plain"
								size="small"
								onClick={() => handleRemove(runner.id)}
								title="Remove runner"
							>
								<WaIcon name="xmark" family="classic" variant="solid" />
							</WaButton>
						</div>
					))}
				</div>
			)}
		</WaCard>
	);
}
