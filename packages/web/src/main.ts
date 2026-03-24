import { BenchdClient, CONFIG_PATH, DEFAULT_CONFIG, SOCKET_PATH, loadConfig } from "@noron/shared";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { BenchGate } from "./bench-gate";
import { BenchScheduler } from "./bench-scheduler";
import { initDb } from "./db";
import { checkRunners } from "./health-check";
import { createRateLimiter } from "./rate-limit";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { inviteRoutes } from "./routes/invite";
import { statusRoutes } from "./routes/status";
import { updateRoutes } from "./routes/update";
import { recordViolation, violationRoutes } from "./routes/violations";
import { workflowRoutes } from "./routes/workflows";
import { validateWsConnection, wsStatusHandler } from "./routes/ws-status";
import { checkForUpdate } from "./update-check";
import { ow, purgeOldWorkflowRuns, setGate, setWorkflowDb } from "./workflows";
// Import workflows so they register with OpenWorkflow
import "./workflows/provision-runner";
import "./workflows/deprovision-runner";
import "./workflows/heal-runner";
import "./workflows/self-update";

const app = new Hono();

// Initialize database
const dbPath = process.env.DATABASE_PATH ?? "./bench.db";
const db = initDb(dbPath);

// Initialize OpenWorkflow — share DB reference with workflows
setWorkflowDb(db);
const worker = ow.newWorker({ concurrency: 1 });
await worker.start();
console.log("[openworkflow] Worker started (concurrency: 1)");

// --- Bench Gate: two-way coordination with benchd ---

const gate = new BenchGate();
setGate(gate);

gate.on("stateChange", (from, to) => {
	console.log(`[bench-gate] ${from} → ${to}`);
});
gate.on("drainTimeout", (level, activeOps) => {
	if (level === "soft")
		console.warn(`[bench-gate] Drain soft deadline — ${activeOps} ops still in-flight`);
	else console.error(`[bench-gate] Drain hard deadline — force-closing ${activeOps} ops`);
});

// Connect to benchd for lock state changes (non-blocking — server starts regardless)
(async () => {
	const gateClient = new BenchdClient(process.env.BENCHD_SOCKET ?? SOCKET_PATH);
	try {
		await gateClient.connect();

		// Check initial lock state — if a benchmark is already running on boot, close immediately
		const initialStatus = await gateClient.request({
			type: "lock.status",
			requestId: crypto.randomUUID(),
		});
		let wasLocked = initialStatus.type === "lock.status" && initialStatus.held;
		if (wasLocked) {
			await gate.closeGate(
				initialStatus.type === "lock.status" ? initialStatus.holder?.owner : undefined,
			);
		}

		// Subscribe to live updates — detect lock transitions
		gateClient.subscribe((update) => {
			const isLocked = update.lock !== null;
			if (isLocked && !wasLocked) {
				gate.closeGate(update.lock?.owner);

				// Push per-repo timeout override if configured
				const owner = update.lock?.owner;
				const override = owner
					? (db.query("SELECT job_timeout_ms FROM runners WHERE repo = ?").get(owner) as {
							job_timeout_ms: number | null;
						} | null)
					: null;
				if (override?.job_timeout_ms) {
					gateClient
						.request({
							type: "lock.setTimeout",
							requestId: crypto.randomUUID(),
							timeoutMs: override.job_timeout_ms,
						})
						.catch(() => {}); // best-effort
				}
			} else if (!isLocked && wasLocked) {
				gate.openGate();
			}
			wasLocked = isLocked;
		});

		// Handle violation events from benchd — record in DB
		gateClient.onViolation((event) => {
			const result = recordViolation(db, event.repo, event.jobId, event.runId, event.reason);
			console.log(
				`[violations] Recorded ${event.reason} for ${event.repo} (strike ${result.strikeCount}${result.disabled ? ", runner disabled" : ""})`,
			);
		});

		console.log("[bench-gate] Connected to benchd");
	} catch {
		console.warn("[bench-gate] Cannot connect to benchd — gate stays open");
	}
})();

// --- Scheduler: replaces startHealthCheck ---

const scheduler = new BenchScheduler(gate);
scheduler.register({
	name: "health-check",
	fn: () => checkRunners(db).then(() => {}),
	intervalMs: 5 * 60_000, // 5 minutes
	initialDelayMs: 10_000,
});
scheduler.register({
	name: "workflow-purge",
	fn: async () => {
		const deleted = purgeOldWorkflowRuns();
		if (deleted > 0) console.log(`[workflow-purge] Removed ${deleted} old workflow runs`);
	},
	intervalMs: 24 * 3600_000, // daily
	initialDelayMs: 30_000,
});
// Load config for update settings
const config = loadConfig(process.env.BENCHD_CONFIG ?? CONFIG_PATH) ?? DEFAULT_CONFIG;

if (config.updateRepo) {
	scheduler.register({
		name: "update-check",
		fn: () => checkForUpdate(db, config),
		intervalMs: config.updateCheckIntervalHours * 3600_000,
		initialDelayMs: 5 * 60_000,
	});
	console.log(
		`[bench-scheduler] Update check scheduled (${config.updateCheckIntervalHours}h), repo: ${config.updateRepo}`,
	);
}
scheduler.register({
	name: "session-cleanup",
	fn: async () => {
		const result = db.run(
			"DELETE FROM device_codes WHERE token IS NOT NULL AND session_expires_at IS NOT NULL AND session_expires_at < ?",
			[Date.now()],
		);
		if (result.changes > 0)
			console.log(`[session-cleanup] Purged ${result.changes} expired sessions`);
	},
	intervalMs: 24 * 3600_000, // daily
	initialDelayMs: 60_000,
});
console.log(
	"[bench-scheduler] Health check (5min), workflow purge (daily), session cleanup (daily)",
);

// Dashboard SPA (served from built React app)
const dashboardDir = process.env.DASHBOARD_DIR ?? "../dashboard/dist";
app.use(
	"/dashboard/*",
	serveStatic({
		root: dashboardDir,
		rewriteRequestPath: (path) => path.replace(/^\/dashboard/, ""),
	}),
);
// SPA fallback — serve index.html for client-side routing
app.get("/dashboard/*", serveStatic({ path: `${dashboardDir}/index.html` }));

// Redirect root to dashboard
app.get("/", (c) => c.redirect("/dashboard/"));

// Static files
app.use("/static/*", serveStatic({ root: "./public" }));

// Rate limiting — protect auth/invite/runner endpoints from brute-force and spam
const inviteRateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });
const authRateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 20 });
const runnerCreateRateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 5 });
const runnerCallbackRateLimit = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });

app.use("/invite/*", inviteRateLimit);
app.use("/auth/*", authRateLimit);
app.on("POST", ["/api/runners"], runnerCreateRateLimit);
app.on("POST", ["/api/runners/*/callback"], runnerCallbackRateLimit);

// Routes
app.route("/invite", inviteRoutes(db));
app.route("/auth", authRoutes(db));
app.route("/api", statusRoutes(db));
app.route("/api", adminRoutes(db, config));
app.route("/api", workflowRoutes(db));
app.route("/api", updateRoutes(db, config));
app.route("/api", violationRoutes(db));

// WebSocket endpoint for live monitoring (same data as TUI)
const wsApp = wsStatusHandler(db);

import { DEFAULT_WEB_PORT } from "@noron/shared";

const port = Number.parseInt(process.env.PORT ?? String(DEFAULT_WEB_PORT), 10);

console.log(`bench-web listening on :${port}`);

export default {
	port,
	fetch(req: globalThis.Request, server: unknown) {
		// Handle WebSocket upgrade for /ws/status
		const url = new URL(req.url);
		if (url.pathname === "/ws/status") {
			const rejection = validateWsConnection(req, db);
			if (rejection) return rejection;
			return wsApp.fetch(req, server);
		}
		return app.fetch(req, server);
	},
	// Bun requires the websocket handler on the server config for upgrades to work
	websocket: wsApp.websocket,
};
