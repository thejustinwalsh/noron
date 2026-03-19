import { beforeEach, describe, expect, test } from "bun:test";
import type { ClientConnection } from "../connection";
import { LockManager } from "../lock";

function mockClient(): ClientConnection & { messages: object[] } {
	const messages: object[] = [];
	return {
		messages,
		send(msg: object) {
			messages.push(msg);
		},
		close() {},
		get id() {
			return "mock";
		},
		subscriptionRequestId: null,
	} as unknown as ClientConnection & { messages: object[] };
}

function acquireReq(jobId: string, owner = "org/repo") {
	return {
		type: "lock.acquire" as const,
		requestId: crypto.randomUUID(),
		jobId,
		runId: `run-${jobId}`,
		owner,
	};
}

/** Extract the jobToken from a lock.acquired response */
function getToken(client: { messages: object[] }, idx = 0): string {
	return (client.messages[idx] as { jobToken: string }).jobToken;
}

function releaseReq(jobId: string, jobToken: string) {
	return {
		type: "lock.release" as const,
		requestId: crypto.randomUUID(),
		jobToken,
		jobId,
	};
}

describe("LockManager", () => {
	let lock: LockManager;
	let changeCount: number;

	beforeEach(() => {
		changeCount = 0;
		// 60s timeout for tests to avoid interference
		lock = new LockManager(() => changeCount++, 60_000);
	});

	test("acquire when free grants immediately with jobToken", () => {
		const c = mockClient();
		lock.acquire(c, acquireReq("j1"));
		expect(c.messages).toHaveLength(1);
		expect((c.messages[0] as { type: string }).type).toBe("lock.acquired");
		expect((c.messages[0] as { position: number }).position).toBe(0);
		expect(getToken(c)).toBeTruthy();
		expect(getToken(c).length).toBe(64); // 32 bytes hex
		expect(changeCount).toBe(1);
	});

	test("second acquire queues", () => {
		const c1 = mockClient();
		const c2 = mockClient();
		lock.acquire(c1, acquireReq("j1"));
		lock.acquire(c2, acquireReq("j2"));
		expect((c2.messages[0] as { type: string }).type).toBe("lock.queued");
		expect((c2.messages[0] as { position: number }).position).toBe(1);
	});

	test("FIFO: release grants to next in queue", () => {
		const c1 = mockClient();
		const c2 = mockClient();
		const c3 = mockClient();
		lock.acquire(c1, acquireReq("j1"));
		lock.acquire(c2, acquireReq("j2"));
		lock.acquire(c3, acquireReq("j3"));

		// Mark action invoked to avoid violation path
		lock.markActionInvoked(getToken(c1));
		lock.release(c1, releaseReq("j1", getToken(c1)));

		// c2 should get lock before c3
		expect(c2.messages).toHaveLength(2); // queued + acquired
		expect((c2.messages[1] as { type: string }).type).toBe("lock.acquired");
		expect(c3.messages).toHaveLength(1); // still just queued
	});

	test("release wrong jobId returns error", () => {
		const c = mockClient();
		lock.acquire(c, acquireReq("j1"));
		const c2 = mockClient();
		lock.release(c2, releaseReq("j-wrong", getToken(c)));
		expect((c2.messages[0] as { type: string }).type).toBe("error");
		expect((c2.messages[0] as { code: string }).code).toBe("lock.wrong_owner");
	});

	test("release with wrong token returns error", () => {
		const c = mockClient();
		lock.acquire(c, acquireReq("j1"));
		const c2 = mockClient();
		lock.release(c2, releaseReq("j1", "bad-token"));
		expect((c2.messages[0] as { type: string }).type).toBe("error");
		expect((c2.messages[0] as { code: string }).code).toBe("auth.invalid_token");
	});

	test("release when not held returns error", () => {
		const c = mockClient();
		lock.release(c, releaseReq("j1", "any-token"));
		expect((c.messages[0] as { type: string }).type).toBe("error");
		expect((c.messages[0] as { code: string }).code).toBe("lock.not_held");
	});

	test("disconnect removes queued client", () => {
		const c1 = mockClient();
		const c2 = mockClient();
		lock.acquire(c1, acquireReq("j1"));
		lock.acquire(c2, acquireReq("j2"));
		expect(lock.queueDepth).toBe(1);

		lock.handleDisconnect(c2);
		expect(lock.queueDepth).toBe(0);
	});

	test("getStatus reports holder and queue depth", () => {
		const c1 = mockClient();
		const c2 = mockClient();
		const status = mockClient();

		lock.getStatus(status, { type: "lock.status", requestId: "r1" });
		expect((status.messages[0] as { held: boolean }).held).toBe(false);

		lock.acquire(c1, acquireReq("j1"));
		lock.acquire(c2, acquireReq("j2"));

		lock.getStatus(status, { type: "lock.status", requestId: "r2" });
		const resp = status.messages[1] as { held: boolean; queueDepth: number };
		expect(resp.held).toBe(true);
		expect(resp.queueDepth).toBe(1);
	});

	test("currentHolder returns null when no lock held", () => {
		expect(lock.currentHolder).toBeNull();
	});

	test("currentHolder includes duration", () => {
		const c = mockClient();
		lock.acquire(c, acquireReq("j1"));
		const holder = lock.currentHolder as NonNullable<typeof lock.currentHolder>;
		expect(holder.jobId).toBe("j1");
		expect(holder.duration).toBeGreaterThanOrEqual(0);
	});

	test("validateToken returns true for valid token", () => {
		const c = mockClient();
		lock.acquire(c, acquireReq("j1"));
		expect(lock.validateToken(getToken(c))).toBe(true);
	});

	test("validateToken returns false for invalid token", () => {
		const c = mockClient();
		lock.acquire(c, acquireReq("j1"));
		expect(lock.validateToken("wrong")).toBe(false);
	});

	test("markActionInvoked sets flag", () => {
		const c = mockClient();
		lock.acquire(c, acquireReq("j1"));
		const token = getToken(c);

		expect(lock.markActionInvoked(token)).toBe(true);
		expect(lock.markActionInvoked("wrong-token")).toBe(false);
	});

	test("release without action checkin returns violation", () => {
		const c = mockClient();
		lock.acquire(c, acquireReq("j1"));
		const token = getToken(c);

		// Release without calling markActionInvoked
		lock.release(c, releaseReq("j1", token));

		const releaseMsg = c.messages[1] as { type: string; violation?: string };
		expect(releaseMsg.type).toBe("lock.released");
		expect(releaseMsg.violation).toBe("action_not_used");
	});

	test("release with action checkin has no violation", () => {
		const c = mockClient();
		lock.acquire(c, acquireReq("j1"));
		const token = getToken(c);

		lock.markActionInvoked(token);
		lock.release(c, releaseReq("j1", token));

		const releaseMsg = c.messages[1] as { type: string; violation?: string };
		expect(releaseMsg.type).toBe("lock.released");
		expect(releaseMsg.violation).toBeUndefined();
	});
});

describe("LockManager onViolation callback", () => {
	let lock: LockManager;
	let violations: { repo: string; jobId: string; runId: string; reason: string }[];

	beforeEach(() => {
		violations = [];
		lock = new LockManager(
			() => {},
			60_000,
			undefined,
			(repo, jobId, runId, reason) => {
				violations.push({ repo, jobId, runId, reason });
			},
		);
	});

	test("onViolation fires with action_not_used when released without action checkin", () => {
		const c = mockClient();
		lock.acquire(c, acquireReq("j1", "org/my-repo"));
		const token = getToken(c);

		lock.release(c, releaseReq("j1", token));

		expect(violations).toHaveLength(1);
		expect(violations[0].reason).toBe("action_not_used");
	});

	test("onViolation does NOT fire when released with action checkin", () => {
		const c = mockClient();
		lock.acquire(c, acquireReq("j1", "org/my-repo"));
		const token = getToken(c);

		lock.markActionInvoked(token);
		lock.release(c, releaseReq("j1", token));

		expect(violations).toHaveLength(0);
	});

	test("onViolation receives correct repo, jobId, runId", () => {
		const c = mockClient();
		lock.acquire(c, acquireReq("j42", "acme/bench-suite"));
		const token = getToken(c);

		lock.release(c, releaseReq("j42", token));

		expect(violations).toHaveLength(1);
		expect(violations[0].repo).toBe("acme/bench-suite");
		expect(violations[0].jobId).toBe("j42");
		expect(violations[0].runId).toBe("run-j42");
	});
});

describe("LockManager setCurrentTimeout", () => {
	test("setCurrentTimeout with short timeout triggers forceRelease", async () => {
		let timeoutFired = false;
		const violations: string[] = [];
		const lock = new LockManager(
			() => {},
			60_000,
			(_owner, _jobId, _runId) => {
				timeoutFired = true;
			},
			(_repo, _jobId, _runId, reason) => {
				violations.push(reason);
			},
		);

		const c = mockClient();
		lock.acquire(c, acquireReq("j1"));

		// Override timeout to something very short
		lock.setCurrentTimeout(50);

		await new Promise((r) => setTimeout(r, 200));

		expect(timeoutFired).toBe(true);
		expect(lock.currentHolder).toBeNull();
		expect(violations).toContain("job_timeout");
	});
});
