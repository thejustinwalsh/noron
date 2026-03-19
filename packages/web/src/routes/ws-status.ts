import type { Database } from "bun:sqlite";
import { BenchdClient, SOCKET_PATH } from "@noron/shared";
import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { getUserByToken } from "../auth-middleware";

const MAX_TOTAL_CONNECTIONS = 50;
const MAX_PER_IP_CONNECTIONS = 5;

/** Track active WebSocket connections for limit enforcement. */
const activeConnections = {
	total: 0,
	byIp: new Map<string, number>(),
};

function getClientIp(req: Request): string {
	return (
		req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
		req.headers.get("x-real-ip") ||
		"unknown"
	);
}

/**
 * WebSocket endpoint that proxies benchd status updates to browser clients.
 * Same data as the TUI — near-zero overhead (one socket reader, fan-out to WS clients).
 *
 * Requires authentication via query string token: /ws/status?token=XXX
 * Enforces connection limits: 50 total, 5 per IP.
 */
export function wsStatusHandler(
	db: Database,
): Hono & { websocket: ReturnType<typeof createBunWebSocket>["websocket"] } {
	const { upgradeWebSocket, websocket } = createBunWebSocket();
	const app = new Hono();

	app.get(
		"/ws/status",
		upgradeWebSocket((c) => {
			const ip = getClientIp(c.req.raw);

			let unsubscribe: (() => void) | null = null;
			let client: BenchdClient | null = null;

			return {
				onOpen(_evt, ws) {
					// Track connection
					activeConnections.total++;
					const ipCount = (activeConnections.byIp.get(ip) ?? 0) + 1;
					activeConnections.byIp.set(ip, ipCount);

					client = new BenchdClient(process.env.BENCHD_SOCKET ?? SOCKET_PATH);
					client
						.connect()
						.then(async () => {
							// Send initial thermal history snapshot
							try {
								const thermalStatus = await client?.request({
									type: "thermal.status",
									requestId: crypto.randomUUID(),
								});
								if (
									thermalStatus &&
									thermalStatus.type === "thermal.status" &&
									"history" in thermalStatus
								) {
									ws.send(
										JSON.stringify({
											type: "thermal.history",
											history: thermalStatus.history,
											currentTemp: thermalStatus.currentTemp,
											trend: thermalStatus.trend,
										}),
									);
								}
							} catch {
								// Non-fatal — live updates will still work
							}

							// Subscribe to live status updates
							unsubscribe =
								client?.subscribe((update) => {
									ws.send(JSON.stringify(update));
								}) ?? null;
						})
						.catch(() => {
							ws.send(JSON.stringify({ type: "error", message: "Cannot reach benchd" }));
							ws.close();
						});
				},
				onClose() {
					// Untrack connection
					activeConnections.total = Math.max(0, activeConnections.total - 1);
					const ipCount = (activeConnections.byIp.get(ip) ?? 1) - 1;
					if (ipCount <= 0) {
						activeConnections.byIp.delete(ip);
					} else {
						activeConnections.byIp.set(ip, ipCount);
					}

					unsubscribe?.();
					client?.close();
				},
			};
		}),
	);

	return Object.assign(app, { websocket });
}

/**
 * Validate WebSocket auth and connection limits before upgrade.
 * Called from the main fetch handler before delegating to wsApp.
 * Returns a Response to reject, or null to allow the upgrade.
 */
export function validateWsConnection(req: Request, db: Database): Response | null {
	const url = new URL(req.url);
	const token = url.searchParams.get("token");

	// Auth check
	if (!token) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), {
			status: 401,
			headers: { "Content-Type": "application/json" },
		});
	}

	const user = getUserByToken(db, token);
	if (!user) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), {
			status: 401,
			headers: { "Content-Type": "application/json" },
		});
	}

	// Connection limit checks
	if (activeConnections.total >= MAX_TOTAL_CONNECTIONS) {
		return new Response(JSON.stringify({ error: "Too many connections" }), {
			status: 429,
			headers: { "Content-Type": "application/json" },
		});
	}

	const ip = getClientIp(req);
	const ipCount = activeConnections.byIp.get(ip) ?? 0;
	if (ipCount >= MAX_PER_IP_CONNECTIONS) {
		return new Response(JSON.stringify({ error: "Too many connections from this IP" }), {
			status: 429,
			headers: { "Content-Type": "application/json" },
		});
	}

	return null; // Allow the upgrade
}

// Exported for testing
export { activeConnections, MAX_TOTAL_CONNECTIONS, MAX_PER_IP_CONNECTIONS };
