import { execSync } from "node:child_process";

/** Detect which container runtime is available. Prefers podman (matches production). */
export function getContainerRuntime(): "podman" | "docker" | null {
	try {
		execSync("which podman", { stdio: "ignore" });
		return "podman";
	} catch {}
	try {
		execSync("which docker", { stdio: "ignore" });
		return "docker";
	} catch {}
	return null;
}

/**
 * Manages a container lifecycle for e2e tests.
 * Phase 2 stub — container-based tests come after host-based e2e works.
 */
export class TestContainer {
	constructor(
		private runtime: "podman" | "docker",
		private name: string,
	) {}

	async build(contextPath: string, tag: string): Promise<void> {
		execSync(`${this.runtime} build -t ${tag} ${contextPath}`, { stdio: "pipe" });
	}

	async run(
		image: string,
		env: Record<string, string>,
		ports: [number, number][] = [],
	): Promise<void> {
		const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
		const portArgs = ports.flatMap(([host, container]) => ["-p", `${host}:${container}`]);
		execSync(
			[this.runtime, "run", "-d", "--rm", "--name", this.name, ...envArgs, ...portArgs, image].join(
				" ",
			),
			{ stdio: "pipe" },
		);
	}

	async stop(): Promise<void> {
		try {
			execSync(`${this.runtime} stop ${this.name}`, { stdio: "pipe", timeout: 10_000 });
		} catch {}
		try {
			execSync(`${this.runtime} rm -f ${this.name}`, { stdio: "pipe", timeout: 5_000 });
		} catch {}
	}

	async logs(): Promise<string> {
		return execSync(`${this.runtime} logs ${this.name}`, { encoding: "utf-8" });
	}
}
