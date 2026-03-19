import { WaBadge, WaButton, WaIcon, WaSpinner } from "@awesome.me/webawesome/dist/react";
import { useWorkflowDetail } from "../hooks/useApi";

interface WorkflowDetailProps {
	workflowRunId: string;
	onBack: () => void;
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "neutral" | "danger" | "brand"> = {
	pending: "neutral",
	running: "warning",
	sleeping: "brand",
	succeeded: "success",
	completed: "success",
	failed: "danger",
	canceled: "neutral",
};

const KIND_VARIANT: Record<string, "neutral" | "brand" | "warning"> = {
	function: "neutral",
	sleep: "brand",
	workflow: "warning",
};

function formatTime(iso: string | null): string {
	if (!iso) return "—";
	return new Date(iso).toLocaleString();
}

function formatDuration(startIso: string | null, endIso: string | null): string {
	if (!startIso) return "—";
	const start = new Date(startIso).getTime();
	if (!endIso) return "in progress";
	const ms = new Date(endIso).getTime() - start;
	if (ms < 1000) return `${ms}ms`;
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ${seconds % 60}s`;
}

function formatJson(val: unknown): string {
	if (val === null || val === undefined) return "—";
	try {
		return JSON.stringify(val, null, 2);
	} catch {
		return String(val);
	}
}

export function WorkflowDetail({ workflowRunId, onBack }: WorkflowDetailProps) {
	const { run, steps, loading } = useWorkflowDetail(workflowRunId);

	if (loading) {
		return (
			<div style={{ display: "flex", justifyContent: "center", padding: "24px" }}>
				<WaSpinner />
			</div>
		);
	}

	if (!run) {
		return <p className="muted">Workflow run not found.</p>;
	}

	return (
		<div className="workflow-detail">
			<div style={{ marginBottom: "16px" }}>
				<WaButton variant="neutral" appearance="outlined" size="small" onClick={onBack}>
					<WaIcon name="arrow-left" family="classic" variant="solid" slot="prefix" />
					Back
				</WaButton>
			</div>

			<div className="workflow-detail-meta">
				<div className="workflow-detail-row">
					<span className="label">Workflow</span>
					<span className="value" style={{ fontWeight: 500 }}>
						{run.workflowName}
					</span>
				</div>
				<div className="workflow-detail-row">
					<span className="label">Status</span>
					<WaBadge pill variant={STATUS_VARIANT[run.status] ?? "neutral"}>
						{run.status}
					</WaBadge>
				</div>
				<div className="workflow-detail-row">
					<span className="label">Idempotency Key</span>
					<code className="value">{run.idempotencyKey ?? "—"}</code>
				</div>
				<div className="workflow-detail-row">
					<span className="label">Attempts</span>
					<span className="value">{run.attempts}</span>
				</div>
				<div className="workflow-detail-row">
					<span className="label">Started</span>
					<span className="value">{formatTime(run.startedAt)}</span>
				</div>
				<div className="workflow-detail-row">
					<span className="label">Finished</span>
					<span className="value">{formatTime(run.finishedAt)}</span>
				</div>
				<div className="workflow-detail-row">
					<span className="label">Duration</span>
					<span className="value" style={{ fontVariantNumeric: "tabular-nums" }}>
						{formatDuration(run.startedAt, run.finishedAt)}
					</span>
				</div>
			</div>

			{run.input != null && (
				<div style={{ marginTop: "16px" }}>
					<h4
						className="muted"
						style={{
							marginBottom: "4px",
							textTransform: "uppercase",
							letterSpacing: "0.05em",
							fontSize: "11px",
						}}
					>
						Input
					</h4>
					<pre className="setup-code">{formatJson(run.input)}</pre>
				</div>
			)}

			{run.error && (
				<div style={{ marginTop: "16px" }}>
					<h4
						style={{
							color: "var(--red)",
							marginBottom: "4px",
							textTransform: "uppercase",
							letterSpacing: "0.05em",
							fontSize: "11px",
						}}
					>
						Error
					</h4>
					<pre className="setup-code" style={{ borderColor: "var(--red)" }}>
						{run.error.message}
						{run.error.stack ? `\n\n${run.error.stack}` : ""}
					</pre>
				</div>
			)}

			{run.output != null && !run.error && (
				<div style={{ marginTop: "16px" }}>
					<h4
						className="muted"
						style={{
							marginBottom: "4px",
							textTransform: "uppercase",
							letterSpacing: "0.05em",
							fontSize: "11px",
						}}
					>
						Output
					</h4>
					<pre className="setup-code">{formatJson(run.output)}</pre>
				</div>
			)}

			{steps.length > 0 && (
				<div style={{ marginTop: "24px" }}>
					<h4
						className="muted"
						style={{
							marginBottom: "8px",
							textTransform: "uppercase",
							letterSpacing: "0.05em",
							fontSize: "11px",
						}}
					>
						Steps ({steps.length})
					</h4>
					<table className="invite-table">
						<thead>
							<tr>
								<th>Status</th>
								<th>Step</th>
								<th>Kind</th>
								<th>Started</th>
								<th>Duration</th>
								<th>Error</th>
							</tr>
						</thead>
						<tbody>
							{steps.map((step) => (
								<tr key={step.id}>
									<td>
										<WaBadge pill variant={STATUS_VARIANT[step.status] ?? "neutral"}>
											{step.status}
										</WaBadge>
									</td>
									<td>{step.stepName}</td>
									<td>
										<WaBadge
											pill
											variant={KIND_VARIANT[step.kind] ?? "neutral"}
											style={{ fontSize: "10px" }}
										>
											{step.kind}
										</WaBadge>
									</td>
									<td>{formatTime(step.startedAt)}</td>
									<td style={{ fontVariantNumeric: "tabular-nums" }}>
										{formatDuration(step.startedAt, step.finishedAt)}
									</td>
									<td>
										{step.error ? (
											<span style={{ color: "var(--red)", fontSize: "12px" }}>
												{typeof step.error === "object" &&
												step.error !== null &&
												"message" in step.error
													? (step.error as { message: string }).message
													: String(step.error)}
											</span>
										) : (
											"—"
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
