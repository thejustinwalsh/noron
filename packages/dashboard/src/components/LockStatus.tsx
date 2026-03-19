import { useEffect, useState } from "react";
import { WaCard, WaBadge, WaCallout, WaIcon } from "@awesome.me/webawesome/dist/react";
import type { LockHolder } from "../types";

interface LockStatusProps {
	lock: LockHolder | null;
	queueDepth: number;
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

export function LockStatus({ lock, queueDepth }: LockStatusProps) {
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

	return (
		<WaCard>
			<div className="lock-status">
				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
					<h3>
						<WaIcon
							name={lock ? "lock" : "lock-open"}
							family="classic"
							variant="solid"
							style={{ marginRight: "6px" }}
						/>
						Lock Status
					</h3>
					<WaBadge pill variant={lock ? "warning" : "success"}>
						{lock ? "HELD" : "IDLE"}
					</WaBadge>
				</div>
				{lock && (
					<div className="lock-details">
						<div className="lock-detail">
							<span className="label">Owner</span>
							<span className="value">{lock.owner}</span>
						</div>
						<div className="lock-detail">
							<span className="label">Job</span>
							<span className="value">{lock.jobId}</span>
						</div>
						<div className="lock-detail">
							<span className="label">Duration</span>
							<span className="value">{formatDuration(elapsed)}</span>
						</div>
					</div>
				)}
				{queueDepth > 0 && (
					<WaCallout variant="warning" size="small">
						{queueDepth} job{queueDepth !== 1 ? "s" : ""} queued
					</WaCallout>
				)}
			</div>
		</WaCard>
	);
}
