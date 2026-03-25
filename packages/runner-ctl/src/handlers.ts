import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { BENCHMARK_TMPFS, DEFAULT_CONFIG, SOCKET_PATH, loadConfig } from "@noron/shared";

const IMAGE = "bench-runner";
let _envdir = process.env.RUNNER_CTL_ENVDIR ?? "/opt/runner/envs";

/** Override the env directory (for testing). */
export function setEnvDir(dir: string): void {
	_envdir = dir;
}

export function getEnvDir(): string {
	return _envdir;
}
const BENCH_EXEC = "/usr/local/bin/bench-exec";
const HOOKS_DIR = "/usr/local/lib/benchd/hooks";

function getHousekeepingCore(): string {
	const config = loadConfig() ?? DEFAULT_CONFIG;
	return String(config.housekeepingCore);
}

function getAllCores(): string {
	const config = loadConfig() ?? DEFAULT_CONFIG;
	return [config.housekeepingCore, ...config.isolatedCores].sort((a, b) => a - b).join(",");
}

function containerName(name: string): string {
	return `bench-${name}`;
}

const NAME_RE = /^[a-zA-Z0-9._-]+$/;

function validateName(val: string, label: string): void {
	if (!NAME_RE.test(val)) {
		throw new Error(`${label} contains invalid characters (allowed: a-z A-Z 0-9 . _ -)`);
	}
}

function validateValue(val: string, label: string): void {
	if (val.includes("\n") || val.includes("\r")) {
		throw new Error(`${label} contains newlines`);
	}
}

const REPO_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function validateRepo(val: string): void {
	if (!REPO_RE.test(val)) {
		throw new Error("repo must be in format owner/repo (alphanumeric, dots, dashes, underscores)");
	}
}

function validateCallbackUrl(val: string): void {
	if (!val) return; // optional
	if (!val.startsWith("http://") && !val.startsWith("https://")) {
		throw new Error("callbackUrl must start with http:// or https://");
	}
}

async function spawn(
	args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
	const exitCode = await proc.exited;
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	return { exitCode, stdout, stderr };
}

export interface ProvisionRequest {
	type: "provision";
	requestId: string;
	name: string;
	repo: string;
	registrationToken: string;
	callbackUrl: string;
	callbackToken: string;
	label: string;
}

export interface DeprovisionRequest {
	type: "deprovision";
	requestId: string;
	name: string;
}

export interface StatusRequest {
	type: "status";
	requestId: string;
	name: string;
}

export type RunnerRequest = ProvisionRequest | DeprovisionRequest | StatusRequest;

export interface RunnerResponse {
	requestId: string;
	type: "provisioned" | "deprovisioned" | "status" | "error";
	[key: string]: unknown;
}

export async function handleProvision(msg: ProvisionRequest): Promise<RunnerResponse> {
	validateName(msg.name, "name");
	validateRepo(msg.repo);
	validateValue(msg.registrationToken, "registrationToken");
	validateCallbackUrl(msg.callbackUrl);
	validateValue(msg.callbackToken, "callbackToken");
	validateName(msg.label, "label");

	const cname = containerName(msg.name);
	const envfile = `${_envdir}/${msg.name}.env`;

	// Create env directory
	mkdirSync(_envdir, { recursive: true, mode: 0o700 });

	// Write env file
	// Podman --env-file reads KEY=VALUE literally (no shell expansion).
	// Input validation above ensures no newlines or metacharacters.
	const envContent = [
		`GITHUB_REPO=${msg.repo}`,
		`RUNNER_NAME=${msg.name}`,
		`RUNNER_LABELS=${msg.label}`,
		`RUNNER_TOKEN=${msg.registrationToken}`,
		...(msg.callbackUrl ? [`BENCH_CALLBACK_URL=${msg.callbackUrl}`] : []),
		...(msg.callbackToken ? [`BENCH_CALLBACK_TOKEN=${msg.callbackToken}`] : []),
		"",
	].join("\n");
	writeFileSync(envfile, envContent, { mode: 0o600 });

	// Stop existing container if present
	const exists = await spawn(["podman", "container", "exists", cname]);
	if (exists.exitCode === 0) {
		await spawn(["podman", "stop", cname]);
		await spawn(["podman", "rm", "-f", cname]);
	}

	// Start container
	const podmanArgs = [
		"podman",
		"run",
		"-d",
		"--rm",
		"--name",
		cname,
		"--env-file",
		envfile,
		"--volume",
		`${dirname(SOCKET_PATH)}:${dirname(SOCKET_PATH)}:rw`,
		"--volume",
		`${BENCH_EXEC}:${BENCH_EXEC}:ro`,
		"--volume",
		`${HOOKS_DIR}:${HOOKS_DIR}:ro`,
		"--volume",
		`${BENCHMARK_TMPFS}:${BENCHMARK_TMPFS}:rw`,
		"--cpuset-cpus",
		getAllCores(),
		"--cap-add=SYS_NICE",
		"--cap-add=CAP_PERFMON",
		IMAGE,
	];
	const result = await spawn(podmanArgs);

	if (result.exitCode !== 0) {
		throw new Error(`podman run failed (${result.exitCode}): ${result.stderr}`);
	}

	return { requestId: msg.requestId, type: "provisioned", container: cname };
}

export async function handleDeprovision(msg: DeprovisionRequest): Promise<RunnerResponse> {
	validateName(msg.name, "name");

	const cname = containerName(msg.name);
	const envfile = `${_envdir}/${msg.name}.env`;

	// Stop and remove container
	const exists = await spawn(["podman", "container", "exists", cname]);
	if (exists.exitCode === 0) {
		await spawn(["podman", "stop", cname]);
		await spawn(["podman", "rm", "-f", cname]);
	}

	// Remove env file
	try {
		unlinkSync(envfile);
	} catch {
		// already gone
	}

	return { requestId: msg.requestId, type: "deprovisioned", container: cname };
}

export async function handleStatus(msg: StatusRequest): Promise<RunnerResponse> {
	validateName(msg.name, "name");

	const cname = containerName(msg.name);

	const exists = await spawn(["podman", "container", "exists", cname]);
	if (exists.exitCode !== 0) {
		return { requestId: msg.requestId, type: "status", state: "not_found" };
	}

	const inspect = await spawn(["podman", "inspect", "--format", "{{.State.Status}}", cname]);
	const state = inspect.stdout.trim() || "unknown";

	if (state !== "running") {
		return { requestId: msg.requestId, type: "status", state: "stopped", detail: state };
	}

	// Verify the benchd socket bind mount is live inside the container.
	// If benchd restarted, the RuntimeDirectory is recreated and the
	// container's bind mount goes stale — the socket file disappears.
	const socketCheck = await spawn(["podman", "exec", cname, "test", "-S", SOCKET_PATH]);
	if (socketCheck.exitCode !== 0) {
		return {
			requestId: msg.requestId,
			type: "status",
			state: "stale",
			detail: "benchd socket not reachable inside container",
		};
	}

	return { requestId: msg.requestId, type: "status", state: "running", detail: state };
}

export async function dispatch(msg: RunnerRequest): Promise<RunnerResponse> {
	switch (msg.type) {
		case "provision":
			return handleProvision(msg);
		case "deprovision":
			return handleDeprovision(msg);
		case "status":
			return handleStatus(msg);
		default:
			return {
				requestId: (msg as { requestId: string }).requestId ?? "",
				type: "error",
				code: "unknown_command",
				message: `Unknown command: ${(msg as { type: string }).type}`,
			};
	}
}
