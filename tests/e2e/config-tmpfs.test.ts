import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BenchdClient } from "../../packages/shared/src/ipc-client";
import { uniquePaths } from "./helpers/fixtures";
import { findAvailablePort } from "./helpers/ports";
import { TestServices } from "./helpers/services";

describe("config.get includes benchTmpfs", () => {
	let services: TestServices;
	let client: BenchdClient;

	beforeAll(async () => {
		const paths = uniquePaths("config-tmpfs");
		const port = await findAvailablePort();
		services = await TestServices.start({ ...paths, port });
		client = new BenchdClient(paths.socketPath);
		await client.connect();
	}, 30_000);

	afterAll(async () => {
		client?.close();
		await services?.shutdown();
	});

	test("config.get response has benchTmpfs field", async () => {
		const resp = await client.request({
			type: "config.get",
			requestId: crypto.randomUUID(),
		});

		expect(resp.type).toBe("config.get");
		if (resp.type === "config.get") {
			expect(resp.benchTmpfs).toBeDefined();
			expect(typeof resp.benchTmpfs).toBe("string");
			// Default config has /mnt/bench-tmpfs
			expect(resp.benchTmpfs).toBe("/mnt/bench-tmpfs");
		}
	});
});
