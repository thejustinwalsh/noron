import { describe, test, expect, beforeEach } from "bun:test";
import { CgroupManager } from "../cgroup";
import type { ClientConnection } from "../connection";

function mockClient(): { messages: object[]; send: (msg: object) => void } {
	const messages: object[] = [];
	return { messages, send(msg: object) { messages.push(msg); } };
}

describe("CgroupManager", () => {
	let cgroup: CgroupManager;

	beforeEach(() => {
		// Use a non-existent cgroup path so it skips real fs ops (macOS dev)
		cgroup = new CgroupManager([1, 2, 3], "/tmp/fake-cgroup");
	});

	test("prepare creates session and responds exec.ready", async () => {
		const c = mockClient();
		await cgroup.prepare(c as unknown as ClientConnection, {
			type: "exec.prepare",
			requestId: "r1",
			jobToken: "test-token",
			cores: [1, 2],
			priority: -20,
		});

		const resp = c.messages[0] as { type: string; sessionId: string; cgroupPath: string };
		expect(resp.type).toBe("exec.ready");
		expect(resp.sessionId).toBeTruthy();
		expect(resp.cgroupPath).toContain("job-");
	});

	test("prepare uses default cores when empty array given", async () => {
		const c = mockClient();
		await cgroup.prepare(c as unknown as ClientConnection, {
			type: "exec.prepare",
			requestId: "r1",
			jobToken: "test-token",
			cores: [],
			priority: -20,
		});

		expect((c.messages[0] as { type: string }).type).toBe("exec.ready");
	});

	test("validate with valid session returns exec.validated", async () => {
		const c = mockClient();
		await cgroup.prepare(c as unknown as ClientConnection, {
			type: "exec.prepare",
			requestId: "r1",
			jobToken: "test-token",
			cores: [1],
			priority: -20,
		});

		const sessionId = (c.messages[0] as { sessionId: string }).sessionId;

		await cgroup.validate(c as unknown as ClientConnection, {
			type: "exec.validate",
			requestId: "r2",
			jobToken: "test-token",
			sessionId,
			pid: 12345,
		});

		expect((c.messages[1] as { type: string }).type).toBe("exec.validated");
	});

	test("validate with unknown session returns exec.invalid", async () => {
		const c = mockClient();
		await cgroup.validate(c as unknown as ClientConnection, {
			type: "exec.validate",
			requestId: "r1",
			jobToken: "test-token",
			sessionId: "nonexistent",
			pid: 12345,
		});

		expect((c.messages[0] as { type: string }).type).toBe("exec.invalid");
		expect((c.messages[0] as { reason: string }).reason).toContain("nonexistent");
	});

	test("cleanup removes session silently", async () => {
		const c = mockClient();
		await cgroup.prepare(c as unknown as ClientConnection, {
			type: "exec.prepare",
			requestId: "r1",
			jobToken: "test-token",
			cores: [1],
			priority: -20,
		});

		const sessionId = (c.messages[0] as { sessionId: string }).sessionId;
		await cgroup.cleanup(sessionId);

		// Validate should now fail
		await cgroup.validate(c as unknown as ClientConnection, {
			type: "exec.validate",
			requestId: "r2",
			jobToken: "test-token",
			sessionId,
			pid: 1,
		});
		expect((c.messages[1] as { type: string }).type).toBe("exec.invalid");
	});

	test("cleanup of nonexistent session is a no-op", async () => {
		await cgroup.cleanup("does-not-exist"); // Should not throw
	});
});
