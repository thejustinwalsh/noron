// ============================================================
// benchd IPC Protocol
// Transport: Unix socket, line-delimited JSON (\n terminated)
// Correlation: every request/response pair shares a requestId
// ============================================================

// --- Base Types ---

export interface BaseRequest {
	requestId: string;
}

export interface BaseResponse {
	requestId: string;
}

// --- Lock Protocol ---

export interface LockAcquireRequest extends BaseRequest {
	type: "lock.acquire";
	jobId: string;
	runId: string;
	owner: string; // github repository (owner/repo)
}

export interface LockAcquiredResponse extends BaseResponse {
	type: "lock.acquired";
	position: number; // 0 = immediate grant, >0 = was queued
	jobToken: string; // cryptographic token for authorizing privileged IPC ops
}

export interface LockQueuedResponse extends BaseResponse {
	type: "lock.queued";
	position: number;
	estimatedWait?: number; // ms
}

export interface LockReleaseRequest extends BaseRequest {
	type: "lock.release";
	jobToken: string;
	jobId: string;
}

export interface LockReleasedResponse extends BaseResponse {
	type: "lock.released";
	violation?: "action_not_used" | "job_timeout";
	timeout?: boolean;
}

export interface LockStatusRequest extends BaseRequest {
	type: "lock.status";
}

export interface LockHolder {
	jobId: string;
	runId: string;
	owner: string;
	acquiredAt: number; // unix timestamp ms
	duration: number; // ms since acquired
}

export interface LockStatusResponse extends BaseResponse {
	type: "lock.status";
	held: boolean;
	holder?: LockHolder;
	queueDepth: number;
}

// --- Thermal Protocol ---

export interface ThermalWaitRequest extends BaseRequest {
	type: "thermal.wait";
	jobToken: string;
	targetTemp: number; // celsius
	timeout?: number; // ms, default THERMAL_TIMEOUT_MS
}

export interface ThermalReadyResponse extends BaseResponse {
	type: "thermal.ready";
	currentTemp: number;
}

export interface ThermalTimeoutResponse extends BaseResponse {
	type: "thermal.timeout";
	currentTemp: number;
	targetTemp: number;
}

export interface ThermalStatusRequest extends BaseRequest {
	type: "thermal.status";
}

export interface ThermalStatusResponse extends BaseResponse {
	type: "thermal.status";
	currentTemp: number;
	history: number[]; // last N readings, newest last
	trend: "rising" | "falling" | "stable";
}

// --- Exec Protocol ---

export interface ExecPrepareRequest extends BaseRequest {
	type: "exec.prepare";
	jobToken: string;
	cores: number[];
	priority: number; // nice value (-20 to 19)
}

export interface ExecReadyResponse extends BaseResponse {
	type: "exec.ready";
	cgroupPath: string;
	sessionId: string;
}

export interface ExecValidateRequest extends BaseRequest {
	type: "exec.validate";
	jobToken: string;
	sessionId: string;
	pid: number;
}

export interface ExecValidatedResponse extends BaseResponse {
	type: "exec.validated";
	cgroupPath: string;
}

export interface ExecInvalidResponse extends BaseResponse {
	type: "exec.invalid";
	reason: string;
}

// --- Action Checkin Protocol ---

export interface ActionCheckinRequest extends BaseRequest {
	type: "action.checkin";
	jobToken: string;
}

export interface ActionCheckinResponse extends BaseResponse {
	type: "action.checkin";
	acknowledged: boolean;
}

// --- Config Protocol ---

export interface ConfigGetRequest extends BaseRequest {
	type: "config.get";
}

export interface ConfigGetResponse extends BaseResponse {
	type: "config.get";
	isolatedCores: number[];
	housekeepingCore: number;
	totalCores: number;
	thermalZones: string[];
	configPath: string;
	benchTmpfs: string;
}

// --- Violation Event ---

export interface ViolationEvent extends BaseResponse {
	type: "violation.occurred";
	repo: string;
	jobId: string;
	runId: string;
	reason: "action_not_used" | "job_timeout";
}

// --- Lock Timeout Override ---

export interface LockSetTimeoutRequest extends BaseRequest {
	type: "lock.setTimeout";
	timeoutMs: number;
}

export interface LockSetTimeoutResponse extends BaseResponse {
	type: "lock.setTimeout";
	applied: boolean;
}

// --- Status Subscription ---

export interface StatusSubscribeRequest extends BaseRequest {
	type: "status.subscribe";
}

export interface SystemInfo {
	isolatedCores: number[];
	housekeepingCore: number;
	totalCores: number;
}

export interface StatusUpdate extends BaseResponse {
	type: "status.update";
	timestamp: number;
	lock: LockHolder | null;
	queueDepth: number;
	thermal: {
		currentTemp: number;
		trend: "rising" | "falling" | "stable";
		idleBaseline?: number | null;
	};
	throttled?: { cores: number[]; totalEvents: number };
	cpu: number; // 0–100 system-wide usage %
	memory: {
		usedMb: number;
		totalMb: number;
		percent: number; // 0–100
	};
	uptime: number; // daemon uptime ms
	version: string;
	system?: SystemInfo;
}

// --- Error ---

export interface ErrorResponse extends BaseResponse {
	type: "error";
	code: string;
	message: string;
}

// --- Union Types ---

export type Request =
	| LockAcquireRequest
	| LockReleaseRequest
	| LockStatusRequest
	| ThermalWaitRequest
	| ThermalStatusRequest
	| ExecPrepareRequest
	| ExecValidateRequest
	| ActionCheckinRequest
	| ConfigGetRequest
	| LockSetTimeoutRequest
	| StatusSubscribeRequest;

export type Response =
	| LockAcquiredResponse
	| LockQueuedResponse
	| LockReleasedResponse
	| LockStatusResponse
	| ThermalReadyResponse
	| ThermalTimeoutResponse
	| ThermalStatusResponse
	| ExecReadyResponse
	| ExecValidatedResponse
	| ExecInvalidResponse
	| ActionCheckinResponse
	| ConfigGetResponse
	| ViolationEvent
	| LockSetTimeoutResponse
	| StatusUpdate
	| ErrorResponse;

/** Map request types to their possible response types */
export type ResponseFor<T extends Request> = T extends LockAcquireRequest
	? LockAcquiredResponse | LockQueuedResponse | ErrorResponse
	: T extends LockReleaseRequest
		? LockReleasedResponse | ErrorResponse
		: T extends LockStatusRequest
			? LockStatusResponse | ErrorResponse
			: T extends ThermalWaitRequest
				? ThermalReadyResponse | ThermalTimeoutResponse | ErrorResponse
				: T extends ThermalStatusRequest
					? ThermalStatusResponse | ErrorResponse
					: T extends ExecPrepareRequest
						? ExecReadyResponse | ErrorResponse
						: T extends ExecValidateRequest
							? ExecValidatedResponse | ExecInvalidResponse | ErrorResponse
							: T extends ActionCheckinRequest
								? ActionCheckinResponse | ErrorResponse
								: T extends ConfigGetRequest
									? ConfigGetResponse | ErrorResponse
									: T extends LockSetTimeoutRequest
										? LockSetTimeoutResponse | ErrorResponse
										: T extends StatusSubscribeRequest
											? StatusUpdate | ErrorResponse
											: ErrorResponse;
