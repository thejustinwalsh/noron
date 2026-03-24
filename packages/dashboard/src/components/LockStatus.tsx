import { WaBadge, WaCard, WaIcon } from "@awesome.me/webawesome/dist/react";
import { useEffect, useState } from "react";
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

	const progress = lock ? Math.min((elapsed / lock.timeoutMs) * 100, 100) : 0;

	if (lock) {
		return (
			<WaCard>
				<div className="lock-card lock-card--active">
					<div className="lock-card-head">
						<h3>
							<WaIcon
								name="bolt"
								family="classic"
								variant="solid"
								style={{ marginRight: "6px", color: "var(--yellow)" }}
							/>
							Benchmarking
						</h3>
						<WaBadge pill variant="warning" attention="pulse">
							HELD
						</WaBadge>
					</div>
					<div className="lock-card-info">
						<div className="lock-detail">
							<span className="label">Repo</span>
							<span className="value">{lock.owner}</span>
						</div>
						<div className="lock-detail">
							<span className="label">Job</span>
							<span className="value">{lock.jobId}</span>
						</div>
						<div className="lock-card-timer">
							<div className="lock-progress-track">
								<div className="lock-progress-fill" style={{ width: `${progress}%` }} />
							</div>
							<div className="lock-progress-labels">
								<span>{formatDuration(elapsed)}</span>
								<span>{formatDuration(lock.timeoutMs)} max</span>
							</div>
						</div>
						{queueDepth > 0 && (
							<span className="lock-queue">
								{queueDepth} job{queueDepth !== 1 ? "s" : ""} waiting
							</span>
						)}
					</div>
				</div>
			</WaCard>
		);
	}

	return (
		<WaCard>
			<div className="lock-card">
				<div className="lock-card-head">
					<h3>
						<WaIcon
							name="lock-open"
							family="classic"
							variant="solid"
							style={{ marginRight: "6px" }}
						/>
						Lock
					</h3>
					<WaBadge pill variant="success">
						IDLE
					</WaBadge>
				</div>
				<div className="lock-card-center">
					<WaIcon
						name="lock-open"
						family="classic"
						variant="solid"
						style={{ fontSize: "42px", color: "var(--text-muted)" }}
					/>
				</div>
				<span className="lock-card-idle-text">Ready for benchmarks</span>
			</div>
		</WaCard>
	);
}
