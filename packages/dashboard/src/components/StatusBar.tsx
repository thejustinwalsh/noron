import { WaBadge, WaIcon } from "@awesome.me/webawesome/dist/react";
import { useEffect, useState } from "react";
import type { LockHolder, WorkflowCounts } from "../types";

interface StatusBarProps {
	lock: LockHolder | null;
	queueDepth: number;
	workflowCounts: WorkflowCounts | null;
	onNavigateWorkflows: () => void;
}

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remaining = seconds % 60;
	if (minutes < 60) return `${minutes}m ${remaining}s`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m`;
}

export function StatusBar({
	lock,
	queueDepth,
	workflowCounts,
	onNavigateWorkflows,
}: StatusBarProps) {
	const [elapsed, setElapsed] = useState(0);

	useEffect(() => {
		if (!lock) {
			setElapsed(0);
			return;
		}
		setElapsed(Date.now() - lock.acquiredAt);
		const interval = setInterval(() => {
			setElapsed(Date.now() - lock.acquiredAt);
		}, 1000);
		return () => clearInterval(interval);
	}, [lock]);

	const active = !!lock;
	const wf = workflowCounts ? buildWorkflowSummary(workflowCounts) : null;

	return (
		<div className={`status-bar${active ? " status-bar--active" : ""}`}>
			<div className="status-bar-left">
				{active ? (
					<>
						<WaIcon
							name="bolt"
							family="classic"
							variant="solid"
							style={{ color: "var(--yellow)", fontSize: "13px" }}
						/>
						<span style={{ fontWeight: 500, color: "var(--yellow)" }}>Critical Section</span>
						<span className="muted">{lock.owner}</span>
						<span className="status-bar-elapsed">{formatDuration(elapsed)}</span>
						{queueDepth > 0 && (
							<WaBadge pill variant="warning" style={{ fontSize: "11px" }}>
								{queueDepth} queued
							</WaBadge>
						)}
					</>
				) : (
					<>
						<span className="status-bar-idle-dot" />
						<span className="muted">Idle</span>
						{queueDepth > 0 && (
							<WaBadge pill variant="warning" style={{ fontSize: "11px" }}>
								{queueDepth} queued
							</WaBadge>
						)}
					</>
				)}
			</div>
			{wf && (
				<div className="status-bar-right">
					<div
						className="workflow-counts-link"
						role="button"
						tabIndex={0}
						onClick={onNavigateWorkflows}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") onNavigateWorkflows?.();
						}}
						title="View workflows"
					>
						<WaIcon
							name="diagram-project"
							family="classic"
							variant="solid"
							style={{ fontSize: "12px" }}
						/>
						<WaBadge pill variant={wf.variant} style={{ fontSize: "11px", cursor: "pointer" }}>
							{wf.text}
						</WaBadge>
					</div>
				</div>
			)}
		</div>
	);
}

function buildWorkflowSummary(
	counts: WorkflowCounts,
): { text: string; variant: "danger" | "warning" | "neutral" | "success" } | null {
	const total =
		counts.running +
		counts.sleeping +
		counts.pending +
		counts.completed +
		counts.failed +
		counts.canceled;
	if (total === 0) return null;

	// Failed takes priority
	if (counts.failed > 0) {
		return { text: `${counts.failed} failed`, variant: "danger" };
	}
	// Active workflows
	const active = counts.running + counts.sleeping + counts.pending;
	if (active > 0) {
		const parts: string[] = [];
		if (counts.running > 0) parts.push(`${counts.running} running`);
		if (counts.sleeping > 0) parts.push(`${counts.sleeping} sleeping`);
		if (counts.pending > 0) parts.push(`${counts.pending} pending`);
		return { text: parts.join(", "), variant: "warning" };
	}
	// All quiet — show total
	return { text: `${total} workflows`, variant: "neutral" };
}
