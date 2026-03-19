import { WaBadge, WaButton, WaCard, WaIcon } from "@awesome.me/webawesome/dist/react";
import { useState } from "react";
import { useWorkflowCounts, useWorkflowRuns } from "../hooks/useApi";
import type { WorkflowCounts, WorkflowRunStatus } from "../types";
import { WorkflowDetail } from "./WorkflowDetail";
import { WorkflowList } from "./WorkflowList";

const FILTERS: { value: string | undefined; label: string; key: keyof WorkflowCounts | null }[] = [
	{ value: undefined, label: "All", key: null },
	{ value: "running", label: "Running", key: "running" },
	{ value: "pending", label: "Pending", key: "pending" },
	{ value: "sleeping", label: "Sleeping", key: "sleeping" },
	{ value: "completed", label: "Completed", key: "completed" },
	{ value: "failed", label: "Failed", key: "failed" },
	{ value: "canceled", label: "Canceled", key: "canceled" },
];

const FILTER_VARIANT: Record<string, "success" | "warning" | "neutral" | "danger" | "brand"> = {
	running: "warning",
	pending: "neutral",
	sleeping: "brand",
	completed: "success",
	failed: "danger",
	canceled: "neutral",
};

export function WorkflowsPage() {
	const [statusFilter, setStatusFilter] = useState<string | undefined>();
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
	const { runs, loading, refetch } = useWorkflowRuns(statusFilter);
	const { counts } = useWorkflowCounts();

	const totalCount = counts
		? counts.pending +
			counts.running +
			counts.sleeping +
			counts.completed +
			counts.failed +
			counts.canceled
		: null;

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
						name="diagram-project"
						family="classic"
						variant="solid"
						style={{ marginRight: "6px" }}
					/>
					Workflows
				</h3>
				<WaButton variant="neutral" appearance="outlined" size="small" onClick={() => refetch()}>
					Refresh
				</WaButton>
			</div>

			{!selectedRunId && (
				<div className="workflow-filters">
					{FILTERS.map((f) => {
						const count = f.key && counts ? counts[f.key] : f.key === null ? totalCount : null;
						const isActive = statusFilter === f.value;
						return (
							<WaBadge
								key={f.label}
								pill
								variant={isActive ? (FILTER_VARIANT[f.value as string] ?? "neutral") : "neutral"}
								style={{
									cursor: "pointer",
									opacity: isActive ? 1 : 0.6,
									fontSize: "12px",
								}}
								onClick={() => setStatusFilter(f.value)}
							>
								{f.label}
								{count !== null && count !== undefined ? ` (${count})` : ""}
							</WaBadge>
						);
					})}
				</div>
			)}

			{selectedRunId ? (
				<WorkflowDetail workflowRunId={selectedRunId} onBack={() => setSelectedRunId(null)} />
			) : (
				<WorkflowList runs={runs} loading={loading} onSelect={setSelectedRunId} />
			)}
		</WaCard>
	);
}
