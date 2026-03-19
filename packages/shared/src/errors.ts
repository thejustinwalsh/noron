export class BenchdError extends Error {
	constructor(
		message: string,
		public readonly code: string,
	) {
		super(message);
		this.name = "BenchdError";
	}
}

export class LockContendedError extends BenchdError {
	constructor(
		public readonly position: number,
		public readonly estimatedWait?: number,
	) {
		super(`Lock contended, position ${position} in queue`, "lock.contended");
		this.name = "LockContendedError";
	}
}

export class ThermalTimeoutError extends BenchdError {
	constructor(
		public readonly currentTemp: number,
		public readonly targetTemp: number,
	) {
		super(`Thermal timeout: ${currentTemp}°C > ${targetTemp}°C target`, "thermal.timeout");
		this.name = "ThermalTimeoutError";
	}
}

export class SessionNotFoundError extends BenchdError {
	constructor(public readonly sessionId: string) {
		super(`No active benchmark session: ${sessionId}`, "exec.no_session");
		this.name = "SessionNotFoundError";
	}
}

export class TokenExpiredError extends BenchdError {
	constructor() {
		super("Invite token has expired", "token.expired");
		this.name = "TokenExpiredError";
	}
}
