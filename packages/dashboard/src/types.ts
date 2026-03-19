/** Mirror of @noron/shared StatusUpdate — kept minimal for browser use */
export interface LockHolder {
	jobId: string;
	runId: string;
	owner: string;
	acquiredAt: number;
	duration: number;
}

export interface SystemInfo {
	isolatedCores: number[];
	housekeepingCore: number;
	totalCores: number;
}

export interface StatusUpdate {
	type: "status.update";
	requestId: string;
	timestamp: number;
	lock: LockHolder | null;
	queueDepth: number;
	thermal: {
		currentTemp: number;
		trend: "rising" | "falling" | "stable";
	};
	cpu: number;
	memory: {
		usedMb: number;
		totalMb: number;
		percent: number;
	};
	uptime: number;
	system?: SystemInfo;
}

export interface ThermalHistory {
	type: "thermal.history";
	history: number[];
	currentTemp: number;
	trend: "rising" | "falling" | "stable";
}

export type WsMessage = StatusUpdate | ThermalHistory | { type: "error"; message: string };

export interface Runner {
	id: string;
	name: string;
	repo: string;
	status: "online" | "offline" | "busy" | "pending" | "provisioning" | "removing" | "failed" | "healing" | "disabled";
	statusMessage: string | null;
	lastHeartbeat: string | null;
	job_timeout_ms: number | null;
	disabled_at: number | null;
	disabled_reason: string | null;
	violationCount: number;
}

export interface Violation {
	id: string;
	repo: string;
	runner_id: string | null;
	job_id: string | null;
	run_id: string | null;
	reason: string;
	created_at: number;
}

export interface UserInfo {
	login: string;
	role: string;
	hasRepoScope: boolean;
	hasPat: boolean;
	runnerCount: number;
}

export interface Invite {
	id: string;
	token: string;
	createdAt: string;
	expiresAt: string;
	usedAt: string | null;
	usedBy: string | null;
}

export interface GithubRepo {
	fullName: string;
	private: boolean;
	description: string | null;
}

export interface ConfigInfo {
	isolatedCores: number[];
	housekeepingCore: number;
	totalCores: number;
	thermalZones: string[];
	configPath: string;
}

export type WorkflowRunStatus = "pending" | "running" | "sleeping" | "succeeded" | "completed" | "failed" | "canceled";

export interface WorkflowRun {
	id: string;
	workflowName: string;
	status: WorkflowRunStatus;
	idempotencyKey: string | null;
	input: unknown;
	output: unknown;
	error: { name?: string; message: string; stack?: string } | null;
	attempts: number;
	startedAt: string | null;
	finishedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface StepAttempt {
	id: string;
	workflowRunId: string;
	stepName: string;
	kind: "function" | "sleep" | "workflow";
	status: "running" | "succeeded" | "completed" | "failed";
	output: unknown;
	error: unknown;
	startedAt: string | null;
	finishedAt: string | null;
	createdAt: string;
}

export interface WorkflowCounts {
	pending: number;
	running: number;
	sleeping: number;
	completed: number;
	failed: number;
	canceled: number;
}
