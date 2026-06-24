import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { html } from "hono/html";

const PROJECT_TYPES = new Set(["open-source", "internal", "commercial", "research", "other"]);

export function landingRoutes(db: Database): Hono {
	const app = new Hono();

	app.get("/", (c) =>
		c.html(html`
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="utf-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1" />
					<title>Noron Benchmarks</title>
					<style>
						:root {
							color-scheme: dark;
							--bg: #0a0d10;
							--panel: #111820;
							--text: #eef4f7;
							--muted: #9cafb8;
							--line: #27343c;
							--accent: #4ade80;
							--accent-2: #38bdf8;
							--danger: #f97316;
						}
						* {
							box-sizing: border-box;
						}
						body {
							margin: 0;
							font-family:
								Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
								sans-serif;
							background:
								linear-gradient(135deg, rgba(74, 222, 128, 0.12), transparent 30%),
								linear-gradient(225deg, rgba(56, 189, 248, 0.12), transparent 28%), var(--bg);
							color: var(--text);
						}
						main {
							width: min(1120px, calc(100% - 32px));
							margin: 0 auto;
							padding: 32px 0 48px;
						}
						.nav {
							display: flex;
							align-items: center;
							justify-content: space-between;
							gap: 16px;
							padding: 12px 0 40px;
						}
						.brand {
							font-size: 18px;
							font-weight: 700;
							letter-spacing: 0;
						}
						.nav a {
							color: var(--muted);
							text-decoration: none;
							font-size: 14px;
						}
						.hero {
							display: grid;
							grid-template-columns: minmax(0, 1.05fr) minmax(320px, 0.95fr);
							gap: 48px;
							align-items: start;
							padding-top: 24px;
						}
						.kicker {
							color: var(--accent);
							font-size: 13px;
							font-weight: 700;
							letter-spacing: 0.08em;
							text-transform: uppercase;
						}
						h1 {
							max-width: 760px;
							margin: 14px 0 18px;
							font-size: clamp(44px, 8vw, 88px);
							line-height: 0.92;
							letter-spacing: 0;
						}
						.lede {
							max-width: 680px;
							margin: 0;
							color: var(--muted);
							font-size: 20px;
							line-height: 1.5;
						}
						.metrics {
							display: grid;
							grid-template-columns: repeat(3, minmax(0, 1fr));
							gap: 14px;
							margin: 34px 0;
						}
						.metric {
							border-top: 1px solid var(--line);
							padding-top: 14px;
						}
						.metric strong {
							display: block;
							font-size: 28px;
						}
						.metric span {
							color: var(--muted);
							font-size: 13px;
						}
						.copy-block {
							max-width: 760px;
							border-left: 3px solid var(--accent-2);
							padding-left: 18px;
							color: #cbd7dd;
							line-height: 1.6;
						}
						.form-panel {
							border: 1px solid var(--line);
							border-radius: 8px;
							background: rgba(17, 24, 32, 0.92);
							padding: 24px;
							box-shadow: 0 24px 80px rgba(0, 0, 0, 0.26);
						}
						.form-panel h2 {
							margin: 0 0 8px;
							font-size: 24px;
						}
						.form-panel p {
							margin: 0 0 20px;
							color: var(--muted);
							line-height: 1.5;
						}
						label {
							display: block;
							margin: 16px 0 7px;
							color: #d8e3e8;
							font-size: 13px;
							font-weight: 650;
						}
						input,
						select,
						textarea {
							width: 100%;
							border: 1px solid #33444d;
							border-radius: 6px;
							background: #0c1217;
							color: var(--text);
							font: inherit;
							padding: 11px 12px;
						}
						textarea {
							min-height: 112px;
							resize: vertical;
						}
						button {
							width: 100%;
							margin-top: 20px;
							border: 0;
							border-radius: 6px;
							background: var(--accent);
							color: #06100a;
							cursor: pointer;
							font: inherit;
							font-weight: 800;
							padding: 12px 16px;
						}
						.note {
							margin-top: 16px;
							color: var(--muted);
							font-size: 12px;
							line-height: 1.5;
						}
						.bands {
							display: grid;
							grid-template-columns: repeat(3, minmax(0, 1fr));
							gap: 18px;
							margin-top: 52px;
						}
						.band {
							border-top: 1px solid var(--line);
							padding-top: 18px;
						}
						.band h3 {
							margin: 0 0 8px;
							font-size: 18px;
						}
						.band p {
							margin: 0;
							color: var(--muted);
							line-height: 1.55;
						}
						@media (max-width: 860px) {
							.hero,
							.bands {
								grid-template-columns: 1fr;
							}
							.metrics {
								grid-template-columns: 1fr;
							}
						}
					</style>
				</head>
				<body>
					<main>
						<nav class="nav">
							<div class="brand">Noron</div>
							<a href="/dashboard/">Dashboard</a>
						</nav>

						<section class="hero">
							<div>
								<div class="kicker">Benchmark hardware for serious CI</div>
								<h1>Benchmarks that stop moving.</h1>
								<p class="lede">
									Noron is a dedicated benchmark appliance for GitHub Actions. It isolates CPU
									cores, gates thermals, and runs one benchmark at a time so performance changes
									show up as signal instead of machine noise.
								</p>
								<div class="metrics">
									<div class="metric">
										<strong>~1.6%</strong>
										<span>median variance observed</span>
									</div>
									<div class="metric">
										<strong>0.08%</strong>
										<span>best-case variance observed</span>
									</div>
									<div class="metric">
										<strong>1</strong>
										<span>benchmark at a time, machine-wide</span>
									</div>
								</div>
								<p class="copy-block">
									Self-host Noron on Armbian-based single-board computers for personal use or
									internal benchmarking. Hosted benchmarking, managed services, SaaS, consulting, and
									customer-facing offerings require a separate commercial license. Free access for
									open source projects is available by approval.
								</p>
							</div>

							<form class="form-panel" method="post" action="/signup">
								<h2>Request access</h2>
								<p>Tell me what you are building and how you want to use Noron.</p>

								<label for="email">Email</label>
								<input id="email" name="email" type="email" autocomplete="email" required />

								<label for="name">Name</label>
								<input id="name" name="name" type="text" autocomplete="name" />

								<label for="company">Company or project</label>
								<input id="company" name="company" type="text" autocomplete="organization" />

								<label for="project_type">Use type</label>
								<select id="project_type" name="project_type" required>
									<option value="open-source">Open source project</option>
									<option value="internal">Internal team use</option>
									<option value="research">Academic or research</option>
									<option value="commercial">Commercial product or service</option>
									<option value="other">Other</option>
								</select>

								<label for="github_url">GitHub URL</label>
								<input
									id="github_url"
									name="github_url"
									type="url"
									placeholder="https://github.com/org/repo"
								/>

								<label for="use_case">Use case</label>
								<textarea id="use_case" name="use_case" required></textarea>

								<button type="submit">Request access</button>
								<div class="note">
									Submitting this form does not grant a license. Open source approvals and
									commercial licenses are issued explicitly.
								</div>
							</form>
						</section>

						<section class="bands">
							<div class="band">
								<h3>Quiet hardware</h3>
								<p>CPU isolation, thermal gating, and benchmark-only cores reduce interference.</p>
							</div>
							<div class="band">
								<h3>GitHub-native</h3>
								<p>Benchmarks run from Actions while the appliance enforces the machine lock.</p>
							</div>
							<div class="band">
								<h3>Commercially protected</h3>
								<p>Self-hosting on Armbian boards is welcome; service businesses need permission.</p>
							</div>
						</section>
					</main>
				</body>
			</html>
		`),
	);

	app.get("/thanks", (c) =>
		c.html(html`
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="utf-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1" />
					<title>Request received - Noron</title>
					<style>
						body {
							margin: 0;
							font-family:
								Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
								sans-serif;
							background: #0a0d10;
							color: #eef4f7;
						}
						main {
							width: min(620px, calc(100% - 32px));
							margin: 18vh auto 0;
						}
						a {
							color: #4ade80;
						}
						p {
							color: #9cafb8;
							line-height: 1.6;
						}
					</style>
				</head>
				<body>
					<main>
						<h1>Request received.</h1>
						<p>I will review the project and follow up if it is a fit for open source access or a commercial license.</p>
						<a href="/">Back to Noron</a>
					</main>
				</body>
			</html>
		`),
	);

	app.post("/signup", async (c) => {
		const body = await c.req.parseBody();
		const email = field(body.email).toLowerCase();
		const name = optionalField(body.name);
		const company = optionalField(body.company);
		const projectType = field(body.project_type);
		const githubUrl = optionalField(body.github_url);
		const useCase = field(body.use_case);

		if (!isValidEmail(email) || !PROJECT_TYPES.has(projectType) || useCase.length < 10) {
			return c.text("Please provide a valid email, use type, and use case.", 400);
		}
		if (githubUrl && !isValidHttpsUrl(githubUrl)) {
			return c.text("Please provide a valid HTTPS GitHub URL.", 400);
		}

		db.run(
			`INSERT INTO signup_applications
				(id, email, name, company, project_type, github_url, use_case, created_at, ip, user_agent)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				crypto.randomUUID(),
				email,
				name,
				company,
				projectType,
				githubUrl,
				useCase,
				Date.now(),
				clientIp(c.req.header("x-forwarded-for"), c.req.header("x-real-ip")),
				c.req.header("user-agent") ?? null,
			],
		);

		return c.redirect("/thanks", 303);
	});

	return app;
}

function field(value: FormDataEntryValue | FormDataEntryValue[] | undefined): string {
	if (Array.isArray(value)) return "";
	if (typeof value !== "string") return "";
	return value.trim().slice(0, 4000);
}

function optionalField(
	value: FormDataEntryValue | FormDataEntryValue[] | undefined,
): string | null {
	const result = field(value);
	return result.length > 0 ? result : null;
}

function isValidEmail(value: string): boolean {
	return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) && value.length <= 254;
}

function isValidHttpsUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "https:" && url.hostname === "github.com";
	} catch {
		return false;
	}
}

function clientIp(forwardedFor: string | undefined, realIp: string | undefined): string | null {
	return forwardedFor?.split(",")[0]?.trim() || realIp || null;
}
