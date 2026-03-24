import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ProvisionRequest,
	dispatch,
	getEnvDir,
	handleDeprovision,
	handleProvision,
	handleStatus,
	setEnvDir,
} from "../handlers";

// --- Helpers ---

function provisionMsg(overrides?: Partial<ProvisionRequest>): ProvisionRequest {
	return {
		type: "provision",
		requestId: "req-1",
		name: "test-runner",
		repo: "owner/repo",
		registrationToken: "AABCDEF123",
		callbackUrl: "http://host.containers.internal:9216/api/runners/r1/callback",
		callbackToken: "cb-token-1",
		label: "noron",
		...overrides,
	};
}

function fakeSpawn(exitCode = 0, stdout = "", stderr = "") {
	const encoder = new TextEncoder();
	return () =>
		({
			exited: Promise.resolve(exitCode),
			stdout: new ReadableStream<Uint8Array>({
				start(controller) {
					if (stdout) controller.enqueue(encoder.encode(stdout));
					controller.close();
				},
			}),
			stderr: new ReadableStream<Uint8Array>({
				start(controller) {
					if (stderr) controller.enqueue(encoder.encode(stderr));
					controller.close();
				},
			}),
			pid: 999,
			killed: false,
			exitCode,
			signalCode: null,
			kill() {},
			ref() {},
			unref() {},
			stdin: undefined,
			resourceUsage() {
				return undefined;
			},
		}) as unknown as ReturnType<typeof Bun.spawn>;
}

// Use temp dir for env files in all tests
let testEnvDir: string;
const origEnvDir = getEnvDir();

beforeEach(() => {
	testEnvDir = join(
		tmpdir(),
		`runner-ctl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(testEnvDir, { recursive: true });
	setEnvDir(testEnvDir);
});

afterEach(() => {
	setEnvDir(origEnvDir);
	rmSync(testEnvDir, { recursive: true, force: true });
});

// --- Validation Tests ---

describe("input validation", () => {
	let spawnSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		spawnSpy = spyOn(Bun, "spawn").mockImplementation(fakeSpawn());
	});

	afterEach(() => {
		spawnSpy.mockRestore();
	});

	test("rejects name with slashes", async () => {
		await expect(handleProvision(provisionMsg({ name: "../escape" }))).rejects.toThrow(
			"name contains invalid characters",
		);
	});

	test("rejects name with spaces", async () => {
		await expect(handleProvision(provisionMsg({ name: "bad name" }))).rejects.toThrow(
			"name contains invalid characters",
		);
	});

	test("rejects empty name", async () => {
		await expect(handleProvision(provisionMsg({ name: "" }))).rejects.toThrow(
			"name contains invalid characters",
		);
	});

	test("accepts valid name with dots and dashes", async () => {
		const result = await handleProvision(provisionMsg({ name: "my-runner.v2" }));
		expect(result.type).toBe("provisioned");
	});

	test("rejects repo with newlines", async () => {
		await expect(handleProvision(provisionMsg({ repo: "owner/repo\nevil" }))).rejects.toThrow(
			"repo must be in format owner/repo",
		);
	});

	test("rejects repo with invalid format", async () => {
		await expect(handleProvision(provisionMsg({ repo: "just-a-name" }))).rejects.toThrow(
			"repo must be in format owner/repo",
		);
	});

	test("rejects repo with shell metacharacters", async () => {
		await expect(handleProvision(provisionMsg({ repo: "owner/repo;evil" }))).rejects.toThrow(
			"repo must be in format owner/repo",
		);
	});

	test("rejects label with invalid characters", async () => {
		await expect(handleProvision(provisionMsg({ label: "bad label!" }))).rejects.toThrow(
			"label contains invalid characters",
		);
	});

	test("rejects deprovision with invalid name", async () => {
		await expect(
			handleDeprovision({ type: "deprovision", requestId: "req-1", name: "../../etc" }),
		).rejects.toThrow("name contains invalid characters");
	});

	test("rejects status with invalid name", async () => {
		await expect(
			handleStatus({ type: "status", requestId: "req-1", name: "bad name" }),
		).rejects.toThrow("name contains invalid characters");
	});
});

// --- Env File Tests ---

describe("env file generation", () => {
	let spawnSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		spawnSpy = spyOn(Bun, "spawn").mockImplementation(fakeSpawn());
	});

	afterEach(() => {
		spawnSpy.mockRestore();
	});

	test("provision writes env file with correct content", async () => {
		const result = await handleProvision(provisionMsg());
		expect(result.type).toBe("provisioned");
		expect(result.container).toBe("bench-test-runner");

		const envPath = join(testEnvDir, "test-runner.env");
		expect(existsSync(envPath)).toBe(true);
		const content = readFileSync(envPath, "utf-8");
		expect(content).toContain("GITHUB_REPO=owner/repo");
		expect(content).toContain("RUNNER_NAME=test-runner");
		expect(content).toContain("RUNNER_LABELS=noron");
		expect(content).toContain("RUNNER_TOKEN=AABCDEF123");
		expect(content).toContain("BENCH_CALLBACK_URL=");
		expect(content).toContain("BENCH_CALLBACK_TOKEN=cb-token-1");
	});

	test("env file does not contain callback fields when empty", async () => {
		const result = await handleProvision(provisionMsg({ callbackUrl: "", callbackToken: "" }));
		expect(result.type).toBe("provisioned");

		const content = readFileSync(join(testEnvDir, "test-runner.env"), "utf-8");
		expect(content).not.toContain("BENCH_CALLBACK_URL");
		expect(content).not.toContain("BENCH_CALLBACK_TOKEN");
	});
});

// --- Podman Interaction Tests ---

describe("podman interactions", () => {
	test("provision stops existing container before starting new one", async () => {
		const calls: string[][] = [];
		const spawnSpy = // @ts-expect-error mock typing
			spyOn(Bun, "spawn").mockImplementation((args: string[]) => {
				calls.push([...args]);
				return fakeSpawn(0, "container-id-123")();
			});

		await handleProvision(provisionMsg());

		// First call: podman container exists
		expect(calls[0]).toEqual(["podman", "container", "exists", "bench-test-runner"]);
		// exists returned 0, so next calls are stop + rm
		expect(calls[1]).toEqual(["podman", "stop", "bench-test-runner"]);
		expect(calls[2]).toEqual(["podman", "rm", "-f", "bench-test-runner"]);
		// Last call: podman run
		expect(calls[3][0]).toBe("podman");
		expect(calls[3][1]).toBe("run");
		expect(calls[3]).toContain("bench-test-runner");
		expect(calls[3]).toContain("bench-runner");

		spawnSpy.mockRestore();
	});

	test("provision skips stop when container does not exist", async () => {
		const calls: string[][] = [];
		const spawnSpy = // @ts-expect-error mock typing
			spyOn(Bun, "spawn").mockImplementation((args: string[]) => {
				calls.push([...args]);
				// "container exists" returns 1 when not found
				if (args[1] === "container" && args[2] === "exists") {
					return fakeSpawn(1)();
				}
				return fakeSpawn(0, "container-id-123")();
			});

		await handleProvision(provisionMsg());

		expect(calls[0]).toEqual(["podman", "container", "exists", "bench-test-runner"]);
		// Skips stop/rm, goes straight to run
		expect(calls[1][0]).toBe("podman");
		expect(calls[1][1]).toBe("run");

		spawnSpy.mockRestore();
	});

	test("provision throws when podman run fails", async () => {
		const spawnSpy = // @ts-expect-error mock typing
			spyOn(Bun, "spawn").mockImplementation((args: string[]) => {
				if (args[1] === "container" && args[2] === "exists") {
					return fakeSpawn(1)();
				}
				// podman run fails
				return fakeSpawn(125, "", "Error: image not found")();
			});

		await expect(handleProvision(provisionMsg())).rejects.toThrow("podman run failed (125)");

		spawnSpy.mockRestore();
	});

	test("status returns running for active container", async () => {
		const spawnSpy = // @ts-expect-error mock typing
			spyOn(Bun, "spawn").mockImplementation((args: string[]) => {
				if (args[1] === "container" && args[2] === "exists") {
					return fakeSpawn(0)();
				}
				if (args[1] === "inspect") {
					return fakeSpawn(0, "running\n")();
				}
				return fakeSpawn(0)();
			});

		const result = await handleStatus({ type: "status", requestId: "req-1", name: "test-runner" });
		expect(result.type).toBe("status");
		expect(result.state).toBe("running");

		spawnSpy.mockRestore();
	});

	test("status returns not_found when container missing", async () => {
		const spawnSpy = spyOn(Bun, "spawn").mockImplementation(fakeSpawn(1));

		const result = await handleStatus({ type: "status", requestId: "req-1", name: "test-runner" });
		expect(result.type).toBe("status");
		expect(result.state).toBe("not_found");

		spawnSpy.mockRestore();
	});

	test("status returns stopped for exited container", async () => {
		const spawnSpy = // @ts-expect-error mock typing
			spyOn(Bun, "spawn").mockImplementation((args: string[]) => {
				if (args[1] === "container" && args[2] === "exists") {
					return fakeSpawn(0)();
				}
				return fakeSpawn(0, "exited\n")();
			});

		const result = await handleStatus({ type: "status", requestId: "req-1", name: "test-runner" });
		expect(result.type).toBe("status");
		expect(result.state).toBe("stopped");

		spawnSpy.mockRestore();
	});

	test("deprovision removes env file", async () => {
		const spawnSpy = spyOn(Bun, "spawn").mockImplementation(fakeSpawn(1));

		const result = await handleDeprovision({
			type: "deprovision",
			requestId: "req-1",
			name: "test-runner",
		});
		expect(result.type).toBe("deprovisioned");
		expect(result.container).toBe("bench-test-runner");

		spawnSpy.mockRestore();
	});
});

// --- Dispatch Tests ---

describe("dispatch", () => {
	let spawnSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		spawnSpy = spyOn(Bun, "spawn").mockImplementation(fakeSpawn());
	});

	afterEach(() => {
		spawnSpy.mockRestore();
	});

	test("routes provision command", async () => {
		const result = await dispatch(provisionMsg());
		expect(result.type).toBe("provisioned");
	});

	test("routes deprovision command", async () => {
		const result = await dispatch({
			type: "deprovision",
			requestId: "req-1",
			name: "test-runner",
		});
		expect(result.type).toBe("deprovisioned");
	});

	test("routes status command", async () => {
		spawnSpy.mockImplementation(fakeSpawn(1));
		const result = await dispatch({ type: "status", requestId: "req-1", name: "test-runner" });
		expect(result.type).toBe("status");
	});

	test("returns error for unknown command", async () => {
		const result = await dispatch({
			type: "restart" as "provision",
			requestId: "req-1",
			name: "test",
		} as ProvisionRequest);
		expect(result.type).toBe("error");
		expect(result.code).toBe("unknown_command");
	});
});
