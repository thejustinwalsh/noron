import type WaInputEl from "@awesome.me/webawesome/dist/components/input/input.js";
import {
	WaBadge,
	WaButton,
	WaCallout,
	WaCard,
	WaIcon,
	WaInput,
	WaSpinner,
} from "@awesome.me/webawesome/dist/react";
import { useState } from "react";
import { useInvites, useRunnerTimeout, useRunners, useViolations } from "../hooks/useApi";

const STATUS_VARIANT: Record<string, "success" | "neutral" | "brand"> = {
	Active: "success",
	Expired: "neutral",
	Used: "brand",
};

export function AdminPanel() {
	const { invites, loading, createInvite } = useInvites();
	const [newInviteUrl, setNewInviteUrl] = useState<string | null>(null);

	const handleCreate = async () => {
		try {
			const invite = await createInvite.mutateAsync();
			setNewInviteUrl(`${window.location.origin}/invite/${invite.token}`);
		} catch {
			// Error handled silently — invite list will show current state
		}
	};

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
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
							name="envelope-open-text"
							family="classic"
							variant="solid"
							style={{ marginRight: "6px" }}
						/>
						Invites
					</h3>
					<WaButton
						variant="brand"
						size="small"
						loading={createInvite.isPending}
						onClick={handleCreate}
					>
						Generate Invite
					</WaButton>
				</div>

				{newInviteUrl && (
					<WaCallout variant="brand" size="small" style={{ marginBottom: "16px" }}>
						<div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
							<span>Invite link created:</span>
							<code
								style={{
									flex: 1,
									fontSize: "12px",
									wordBreak: "break-all",
									background: "var(--bg)",
									padding: "4px 8px",
									borderRadius: "4px",
									minWidth: "200px",
								}}
							>
								{newInviteUrl}
							</code>
							<WaButton
								variant="neutral"
								appearance="outlined"
								size="small"
								onClick={() => {
									navigator.clipboard.writeText(newInviteUrl);
								}}
							>
								Copy
							</WaButton>
						</div>
					</WaCallout>
				)}

				{loading && (
					<div style={{ display: "flex", justifyContent: "center", padding: "24px" }}>
						<WaSpinner />
					</div>
				)}

				{invites.length > 0 && (
					<table className="invite-table">
						<thead>
							<tr>
								<th>Token</th>
								<th>Created</th>
								<th>Expires</th>
								<th>Status</th>
							</tr>
						</thead>
						<tbody>
							{invites.map((invite) => {
								const expired = new Date(invite.expiresAt) < new Date();
								const status = invite.usedAt ? "Used" : expired ? "Expired" : "Active";
								return (
									<tr key={invite.id}>
										<td>
											<code>{invite.token.slice(0, 8)}...</code>
										</td>
										<td>{new Date(invite.createdAt).toLocaleDateString()}</td>
										<td>{new Date(invite.expiresAt).toLocaleDateString()}</td>
										<td>
											<WaBadge pill variant={STATUS_VARIANT[status] ?? "neutral"}>
												{status}
											</WaBadge>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				)}
			</WaCard>

			<RunnerPolicies />
			<ViolationsPanel />
		</div>
	);
}

/** Admin panel for per-repo timeout overrides */
function RunnerPolicies() {
	const { runners, loading } = useRunners();
	const { setTimeout } = useRunnerTimeout();
	const [editingId, setEditingId] = useState<string | null>(null);
	const [timeoutValue, setTimeoutValue] = useState("");

	const handleSaveTimeout = async (runnerId: string) => {
		const minutes = Number.parseInt(timeoutValue, 10);
		const ms = timeoutValue.trim() === "" ? null : minutes * 60_000;

		if (ms !== null && (Number.isNaN(minutes) || minutes < 1 || minutes > 1440)) {
			return; // Validation: 1 min to 24 hours
		}

		await setTimeout.mutateAsync({ runnerId, jobTimeoutMs: ms });
		setEditingId(null);
		setTimeoutValue("");
	};

	const startEditing = (runnerId: string, currentMs: number | null) => {
		setEditingId(runnerId);
		setTimeoutValue(currentMs != null ? String(Math.round(currentMs / 60_000)) : "");
	};

	if (loading) return null;
	if (runners.length === 0) return null;

	return (
		<WaCard>
			<h3 style={{ marginBottom: "12px" }}>
				<WaIcon name="clock" family="classic" variant="solid" style={{ marginRight: "6px" }} />
				Job Timeout Overrides
			</h3>
			<p className="muted" style={{ marginBottom: "12px", fontSize: "13px" }}>
				Global default: 10 minutes. Set per-repo overrides below (blank = use default).
			</p>

			<table className="invite-table">
				<thead>
					<tr>
						<th>Repo</th>
						<th>Strikes</th>
						<th>Status</th>
						<th>Timeout</th>
						<th />
					</tr>
				</thead>
				<tbody>
					{runners.map((runner) => (
						<tr key={runner.id}>
							<td>
								<code>{runner.repo}</code>
							</td>
							<td>
								{runner.violationCount > 0 ? (
									<WaBadge pill variant={runner.violationCount >= 3 ? "danger" : "warning"}>
										{runner.violationCount}/3
									</WaBadge>
								) : (
									<span className="muted">0</span>
								)}
							</td>
							<td>
								<WaBadge
									pill
									variant={
										runner.status === "disabled"
											? "danger"
											: runner.status === "online"
												? "success"
												: "neutral"
									}
								>
									{runner.status}
								</WaBadge>
							</td>
							<td>
								{editingId === runner.id ? (
									<div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
										<WaInput
											size="small"
											placeholder="min"
											value={timeoutValue}
											onInput={(e) =>
												setTimeoutValue((e.target as unknown as WaInputEl).value ?? "")
											}
											style={{ width: "70px" }}
										/>
										<span className="muted" style={{ fontSize: "12px" }}>
											min
										</span>
									</div>
								) : (
									<span>
										{runner.job_timeout_ms != null ? (
											`${Math.round(runner.job_timeout_ms / 60_000)} min`
										) : (
											<span className="muted">default</span>
										)}
									</span>
								)}
							</td>
							<td>
								{editingId === runner.id ? (
									<div style={{ display: "flex", gap: "4px" }}>
										<WaButton
											variant="brand"
											size="small"
											loading={setTimeout.isPending}
											onClick={() => handleSaveTimeout(runner.id)}
										>
											Save
										</WaButton>
										<WaButton
											variant="neutral"
											appearance="plain"
											size="small"
											onClick={() => {
												setEditingId(null);
												setTimeoutValue("");
											}}
										>
											Cancel
										</WaButton>
									</div>
								) : (
									<WaButton
										variant="neutral"
										appearance="plain"
										size="small"
										onClick={() => startEditing(runner.id, runner.job_timeout_ms)}
										title="Edit timeout"
									>
										<WaIcon name="pen" family="classic" variant="solid" />
									</WaButton>
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</WaCard>
	);
}

/** Admin panel for viewing and resetting violations */
function ViolationsPanel() {
	const { violations, loading, resetViolations } = useViolations();
	const [confirmReset, setConfirmReset] = useState<string | null>(null);

	const handleReset = async (repo: string) => {
		await resetViolations.mutateAsync(repo);
		setConfirmReset(null);
	};

	// Group violations by repo
	const byRepo = violations.reduce<Record<string, typeof violations>>((acc, v) => {
		acc[v.repo] ??= [];
		acc[v.repo].push(v);
		return acc;
	}, {});

	return (
		<WaCard>
			<h3 style={{ marginBottom: "12px" }}>
				<WaIcon
					name="triangle-exclamation"
					family="classic"
					variant="solid"
					style={{ marginRight: "6px" }}
				/>
				Violations
			</h3>
			<p className="muted" style={{ marginBottom: "12px", fontSize: "13px" }}>
				Jobs that completed without invoking the Noron action. 3 strikes in 30 days disables the
				runner.
			</p>

			{loading && (
				<div style={{ display: "flex", justifyContent: "center", padding: "24px" }}>
					<WaSpinner />
				</div>
			)}

			{!loading && violations.length === 0 && <p className="muted">No violations recorded.</p>}

			{Object.entries(byRepo).map(([repo, repoViolations]) => (
				<div key={repo} style={{ marginBottom: "16px" }}>
					<div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
						<code style={{ fontSize: "13px" }}>{repo}</code>
						<WaBadge pill variant={repoViolations.length >= 3 ? "danger" : "warning"}>
							{repoViolations.length} strike{repoViolations.length !== 1 ? "s" : ""}
						</WaBadge>
						{confirmReset === repo ? (
							<div style={{ display: "flex", gap: "4px" }}>
								<WaButton
									variant="danger"
									size="small"
									loading={resetViolations.isPending}
									onClick={() => handleReset(repo)}
								>
									Confirm Reset
								</WaButton>
								<WaButton
									variant="neutral"
									appearance="plain"
									size="small"
									onClick={() => setConfirmReset(null)}
								>
									Cancel
								</WaButton>
							</div>
						) : (
							<WaButton
								variant="neutral"
								appearance="outlined"
								size="small"
								onClick={() => setConfirmReset(repo)}
							>
								Reset Strikes
							</WaButton>
						)}
					</div>
					<table className="invite-table" style={{ fontSize: "12px" }}>
						<thead>
							<tr>
								<th>Date</th>
								<th>Reason</th>
								<th>Job</th>
							</tr>
						</thead>
						<tbody>
							{repoViolations.slice(0, 10).map((v) => (
								<tr key={v.id}>
									<td>{new Date(v.created_at).toLocaleString()}</td>
									<td>{v.reason}</td>
									<td>
										<code>{v.job_id ?? "—"}</code>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			))}
		</WaCard>
	);
}
