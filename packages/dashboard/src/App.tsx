import { WaCard, WaIcon } from "@awesome.me/webawesome/dist/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AdminPanel } from "./components/AdminPanel";
import { Layout } from "./components/Layout";
import { LockStatus } from "./components/LockStatus";
import { LoginPrompt } from "./components/LoginPrompt";
import { Onboarding } from "./components/Onboarding";
import { RunnerList } from "./components/RunnerList";
import { SparklineChart } from "./components/SparklineChart";
import { SystemInfo } from "./components/SystemInfo";
import { WorkflowsPage } from "./components/WorkflowsPage";
import { useUserInfo, useWorkflowCounts } from "./hooks/useApi";
import { useAuth } from "./hooks/useAuth";
import { useWebSocket } from "./hooks/useWebSocket";

function cpuColor(_pct: number): string {
	return "#1f9de2";
}

function memColor(pct: number): string {
	if (pct < 50) return "#a855f7";
	if (pct < 80) return "#d78000";
	return "#e02c2b";
}

function tempColor(temp: number): string {
	if (temp < 40) return "#21ab52";
	if (temp < 55) return "#d78000";
	return "#e02c2b";
}

export function App() {
	const [page, setPage] = useState("dashboard");
	const { status, thermalHistory, cpuHistory, memoryHistory, connected } = useWebSocket();
	const { authenticated, login, logout } = useAuth();
	const { userInfo } = useUserInfo();
	const { counts: workflowCounts } = useWorkflowCounts();
	const queryClient = useQueryClient();
	const isAdmin = userInfo?.role === "admin";
	const [autoAddRunner, setAutoAddRunner] = useState(false);

	// Detect ?upgraded=1 from OAuth upgrade redirect
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (params.get("upgraded") === "1") {
			queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
			setPage("runners");
			setAutoAddRunner(true);
			const url = new URL(window.location.href);
			url.searchParams.delete("upgraded");
			window.history.replaceState({}, "", url.pathname + url.search);
		}
	}, [queryClient]);

	const currentTemp = status?.thermal.currentTemp ?? 0;
	const currentCpu = status?.cpu ?? 0;
	const currentMem = status?.memory?.percent ?? 0;
	const memUsed = status?.memory?.usedMb ?? 0;
	const memTotal = status?.memory?.totalMb ?? 0;

	// Dynamic ranges from recorded data
	const tempStats = useMemo(() => {
		if (thermalHistory.length === 0) return { min: 0, max: 80, rangeMin: 20, rangeMax: 80 };
		const min = Math.min(...thermalHistory);
		const max = Math.max(...thermalHistory);
		const pad = 5;
		return {
			min: +min.toFixed(1),
			max: +max.toFixed(1),
			rangeMin: Math.floor((min - pad) / 5) * 5,
			rangeMax: Math.ceil((max + pad) / 5) * 5,
		};
	}, [thermalHistory]);

	const cpuStats = useMemo(() => {
		if (cpuHistory.length === 0) return { min: 0, max: 0 };
		return {
			min: +Math.min(...cpuHistory).toFixed(1),
			max: +Math.max(...cpuHistory).toFixed(1),
		};
	}, [cpuHistory]);

	return (
		<Layout
			connected={connected}
			currentPage={page}
			onNavigate={setPage}
			authenticated={authenticated}
			login={login}
			isAdmin={!!isAdmin}
			lock={status?.lock ?? null}
			queueDepth={status?.queueDepth ?? 0}
			workflowCounts={workflowCounts}
			onLogout={logout}
		>
			{page === "dashboard" && (
				<div className="grid">
					<div className="grid-wide">
						<div className="sparkline-strip">
							<WaCard>
								<div className="sparkline-card">
									<div className="sparkline-header">
										<span className="sparkline-label">
											<WaIcon
												name="temperature-half"
												family="classic"
												variant="solid"
												style={{ marginRight: "6px", color: tempColor(currentTemp) }}
											/>
											Temperature
										</span>
										<span className="sparkline-value" style={{ color: tempColor(currentTemp) }}>
											{currentTemp.toFixed(1)}°C
										</span>
									</div>
									<SparklineChart
										data={thermalHistory}
										color={tempColor(currentTemp)}
										min={tempStats.rangeMin}
										max={tempStats.rangeMax}
									/>
									<div className="sparkline-footer">
										<span>{tempStats.min}° min</span>
										<span>{tempStats.max}° max</span>
									</div>
								</div>
							</WaCard>
							<WaCard>
								<div className="sparkline-card">
									<div className="sparkline-header">
										<span className="sparkline-label">
											<WaIcon
												name="microchip"
												family="classic"
												variant="solid"
												style={{ marginRight: "6px", color: cpuColor(currentCpu) }}
											/>
											CPU
										</span>
										<span className="sparkline-value" style={{ color: cpuColor(currentCpu) }}>
											{currentCpu.toFixed(1)}%
										</span>
									</div>
									<SparklineChart
										data={cpuHistory}
										color={cpuColor(currentCpu)}
										min={0}
										max={100}
									/>
									<div className="sparkline-footer">
										<span>{cpuStats.min}% min</span>
										<span>{cpuStats.max}% max</span>
									</div>
								</div>
							</WaCard>
							<WaCard>
								<div className="sparkline-card">
									<div className="sparkline-header">
										<span className="sparkline-label">
											<WaIcon
												name="memory"
												family="classic"
												variant="solid"
												style={{ marginRight: "6px", color: memColor(currentMem) }}
											/>
											Memory
										</span>
										<span className="sparkline-value" style={{ color: memColor(currentMem) }}>
											{currentMem.toFixed(1)}%
										</span>
									</div>
									<SparklineChart
										data={memoryHistory}
										color={memColor(currentMem)}
										min={0}
										max={100}
									/>
									<div className="sparkline-footer">
										<span>{(memUsed / 1024).toFixed(1)} GB used</span>
										<span>{(memTotal / 1024).toFixed(1)} GB total</span>
									</div>
								</div>
							</WaCard>
						</div>
					</div>
					<LockStatus lock={status?.lock ?? null} queueDepth={status?.queueDepth ?? 0} />
					<SystemInfo system={status?.system} uptime={status?.uptime ?? 0} />
				</div>
			)}
			{page === "runners" &&
				(authenticated ? (
					userInfo && !userInfo.hasRepoScope && userInfo.runnerCount === 0 ? (
						<Onboarding
							onComplete={() => queryClient.invalidateQueries({ queryKey: ["auth", "me"] })}
						/>
					) : (
						<RunnerList
							hasRepoScope={userInfo?.hasRepoScope}
							autoAdd={autoAddRunner}
							onAutoAddConsumed={() => setAutoAddRunner(false)}
						/>
					)
				) : (
					<LoginPrompt />
				))}
			{page === "workflows" && (authenticated ? <WorkflowsPage /> : <LoginPrompt />)}
			{page === "admin" && (authenticated && isAdmin ? <AdminPanel /> : <LoginPrompt />)}
		</Layout>
	);
}
