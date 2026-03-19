import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { Request } from "@noron/shared";
import { ClientConnection } from "../connection";

function mockSocket() {
	const emitter = new EventEmitter();
	let written = "";
	return Object.assign(emitter, {
		writable: true,
		write(data: string) {
			written += data;
		},
		end() {},
		get remoteAddress() {
			return "127.0.0.1";
		},
		get remotePort() {
			return 9999;
		},
		_written() {
			return written;
		},
	});
}

describe("ClientConnection", () => {
	test("parses line-delimited JSON messages", () => {
		const socket = mockSocket();
		const received: Request[] = [];
		new ClientConnection(socket as never, (msg) => received.push(msg));

		socket.emit("data", Buffer.from('{"type":"lock.status","requestId":"r1"}\n'));
		expect(received).toHaveLength(1);
		expect(received[0].type).toBe("lock.status");
	});

	test("handles partial messages across chunks", () => {
		const socket = mockSocket();
		const received: Request[] = [];
		new ClientConnection(socket as never, (msg) => received.push(msg));

		socket.emit("data", Buffer.from('{"type":"lock.s'));
		socket.emit("data", Buffer.from('tatus","requestId":"r1"}\n'));
		expect(received).toHaveLength(1);
	});

	test("sends error on invalid JSON", () => {
		const socket = mockSocket();
		new ClientConnection(socket as never, () => {});

		socket.emit("data", Buffer.from("not json\n"));
		expect(socket._written()).toContain("parse_error");
	});

	test("tracks subscription requestId", () => {
		const socket = mockSocket();
		const conn = new ClientConnection(socket as never, () => {});

		socket.emit("data", Buffer.from('{"type":"status.subscribe","requestId":"sub-1"}\n'));
		expect(conn.subscriptionRequestId).toBe("sub-1");
	});

	test("send skips if socket not writable", () => {
		const socket = mockSocket();
		socket.writable = false;
		const conn = new ClientConnection(socket as never, () => {});
		conn.send({ type: "test" }); // Should not throw
	});
});
