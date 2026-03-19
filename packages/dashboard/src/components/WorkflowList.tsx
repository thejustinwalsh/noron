import { WaBadge, WaSpinner } from "@awesome.me/webawesome/dist/react";
import type { WorkflowRun } from "../types";

interface WorkflowListProps {
	runs: WorkflowRun[];
	loading: boolean;
	onSelect: (id: string) => void;
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

function formatTime(iso: string | null): string {
	if (!iso) return "—";
	const d = new Date(iso);
	return d.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
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

function truncate(s: string | null, max: number): string {
	if (!s) return "—";
	return s.length > max ? `${s.slice(0, max)}...` : s;
}

export function WorkflowList({ runs, loading, onSelect }: WorkflowListProps) {
	if (loading) {
		return (
			<div style={{ display: "flex", justifyContent: "center", padding: "24px" }}>
				<WaSpinner />
			</div>
		);
	}

	if (runs.length === 0) {
		return <p className="muted">No workflow runs found.</p>;
	}

	return (
		<table className="invite-table">
			<thead>
				<tr>
					<th>Status</th>
					<th>Workflow</th>
					<th>Key</th>
					<th>Attempts</th>
					<th>Started</th>
					<th>Duration</th>
				</tr>
			</thead>
			<tbody>
				{runs.map((run) => (
					<tr
						key={run.id}
						className="workflow-row"
						onClick={() => onSelect(run.id)}
					>
						<td>
							<WaBadge pill variant={STATUS_VARIANT[run.status] ?? "neutral"}>
								{run.status}
							</WaBadge>
						</td>
						<td>{run.workflowName}</td>
						<td>
							<code>{truncate(run.idempotencyKey, 30)}</code>
						</td>
						<td>{run.attempts}</td>
						<td>{formatTime(run.startedAt)}</td>
						<td style={{ fontVariantNumeric: "tabular-nums" }}>
							{formatDuration(run.startedAt, run.finishedAt)}
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
