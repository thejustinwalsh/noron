import type { Plugin } from "vite";
import { type WebSocket, WebSocketServer } from "ws";

/** Vite plugin that stubs the benchd API + WebSocket so `bun run dev` works without a backend. */
export function mockBenchd(): Plugin {
	let wss: WebSocketServer | null = null;
	let interval: ReturnType<typeof setInterval> | null = null;

	// Simulated state
	let temp = 38 + Math.random() * 5;
	let cpu = 8 + Math.random() * 10;
	let mem = 30 + Math.random() * 10;
	let disk = 35 + Math.random() * 5;
	let tick = 0;

	function buildUpdate() {
		tick++;
		// Gentle random walk
		temp += (Math.random() - 0.52) * 0.6;
		temp = Math.max(28, Math.min(72, temp));
		cpu += (Math.random() - 0.5) * 4;
		cpu = Math.max(1, Math.min(95, cpu));
		mem += (Math.random() - 0.5) * 1.5;
		mem = Math.max(15, Math.min(85, mem));
		disk += (Math.random() - 0.48) * 0.1;
		disk = Math.max(10, Math.min(90, disk));

		const trend = temp > 45 ? "rising" : temp < 35 ? "falling" : "stable";
		return JSON.stringify({
			type: "status.update",
			requestId: "",
			timestamp: Date.now(),
			lock: null,
			queueDepth: 0,
			thermal: { currentTemp: +temp.toFixed(1), trend },
			cpu: +cpu.toFixed(1),
			memory: {
				usedMb: Math.round((mem / 100) * 8192),
				totalMb: 8192,
				percent: +mem.toFixed(1),
			},
			disk: {
				usedGb: +((disk / 100) * 256).toFixed(1),
				totalGb: 256,
				percent: +disk.toFixed(1),
			},
			uptime: tick * 1000,
			system: {
				isolatedCores: [1, 2, 3],
				housekeepingCore: 0,
				totalCores: 4,
			},
		});
	}

	return {
		name: "mock-benchd",
		configureServer(server) {
			// REST stubs
			server.middlewares.use((req, res, next) => {
				if (req.url === "/api/auth/me") {
					res.setHeader("Content-Type", "application/json");
					res.end(
						JSON.stringify({
							login: "dev-user",
							role: "admin",
							hasRepoScope: true,
							hasPat: true,
							runnerCount: 3,
						}),
					);
					return;
				}
				if (req.url === "/api/workflows/counts") {
					res.setHeader("Content-Type", "application/json");
					res.end(
						JSON.stringify({
							pending: 0,
							running: 0,
							sleeping: 0,
							completed: 5,
							failed: 0,
							canceled: 0,
						}),
					);
					return;
				}
				if (req.url === "/api/config") {
					res.setHeader("Content-Type", "application/json");
					res.end(
						JSON.stringify({
							isolatedCores: [1, 2, 3],
							housekeepingCore: 0,
							totalCores: 4,
							thermalZones: ["x86_pkg_temp"],
							configPath: "/etc/benchd/config.toml",
						}),
					);
					return;
				}
				if (req.url === "/api/runners") {
					res.setHeader("Content-Type", "application/json");
					res.end(
						JSON.stringify([
							{
								id: "1",
								name: "runner-1",
								repo: "org/bench-app",
								status: "online",
								lastHeartbeat: new Date().toISOString(),
							},
							{
								id: "2",
								name: "runner-2",
								repo: "org/bench-lib",
								status: "busy",
								lastHeartbeat: new Date().toISOString(),
							},
							{
								id: "3",
								name: "runner-3",
								repo: "org/bench-core",
								status: "offline",
								lastHeartbeat: new Date(Date.now() - 3600000).toISOString(),
							},
						]),
					);
					return;
				}
				if (req.url === "/api/invites") {
					res.setHeader("Content-Type", "application/json");
					if (req.method === "POST") {
						const token = Math.random().toString(36).slice(2, 14);
						res.end(
							JSON.stringify({
								id: token,
								token,
								createdAt: new Date().toISOString(),
								expiresAt: new Date(Date.now() + 86400000).toISOString(),
								usedAt: null,
								usedBy: null,
							}),
						);
						return;
					}
					res.end(
						JSON.stringify([
							{
								id: "inv-1",
								token: "abc123def456",
								createdAt: new Date(Date.now() - 86400000).toISOString(),
								expiresAt: new Date(Date.now() + 86400000).toISOString(),
								usedAt: null,
								usedBy: null,
							},
							{
								id: "inv-2",
								token: "xyz789ghi012",
								createdAt: new Date(Date.now() - 172800000).toISOString(),
								expiresAt: new Date(Date.now() - 86400000).toISOString(),
								usedAt: null,
								usedBy: null,
							},
						]),
					);
					return;
				}
				next();
			});

			// WebSocket stub
			wss = new WebSocketServer({ noServer: true });
			server.httpServer?.on("upgrade", (req, socket, head) => {
				if (req.url === "/ws/status") {
					wss?.handleUpgrade(req, socket, head, (ws) => {
						wss?.emit("connection", ws, req);
					});
				}
			});

			wss.on("connection", (ws: WebSocket) => {
				// Send initial history burst
				const history: number[] = [];
				let t = 35 + Math.random() * 5;
				for (let i = 0; i < 60; i++) {
					t += (Math.random() - 0.5) * 0.8;
					t = Math.max(28, Math.min(72, t));
					history.push(+t.toFixed(1));
				}
				ws.send(
					JSON.stringify({
						type: "thermal.history",
						history,
						currentTemp: history[history.length - 1],
						trend: "stable",
					}),
				);

				// Live updates at 1Hz
				ws.send(buildUpdate());
			});

			interval = setInterval(() => {
				const msg = buildUpdate();
				for (const client of wss?.clients ?? []) {
					if (client.readyState === 1) client.send(msg);
				}
			}, 1000);
		},
		closeBundle() {
			if (interval) clearInterval(interval);
			wss?.close();
		},
	};
}
