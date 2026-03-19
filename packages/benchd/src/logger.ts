type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

let minLevel: LogLevel = "info";

export function setLogLevel(level: string): void {
	if (level in LEVELS) {
		minLevel = level as LogLevel;
	}
}

export function log(
	level: LogLevel,
	component: string,
	message: string,
	meta?: Record<string, unknown>,
): void {
	if (LEVELS[level] < LEVELS[minLevel]) return;

	const entry = {
		ts: new Date().toISOString(),
		level,
		component,
		msg: message,
		...meta,
	};

	const line = JSON.stringify(entry);

	if (level === "error" || level === "warn") {
		process.stderr.write(`${line}\n`);
	} else {
		process.stderr.write(`${line}\n`);
	}
}
