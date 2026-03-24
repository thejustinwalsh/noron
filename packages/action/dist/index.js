import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// src/index.ts
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { connect } from "node:net";
var SOCKET_PATH = process.env.BENCHD_SOCKET ?? "/var/run/benchd.sock";
var JOB_TOKEN_PATH = process.env.JOB_TOKEN_PATH ?? "/opt/actions-runner/.benchd-token";
function sendRequest(socketPath, msg) {
  return new Promise((resolve, reject) => {
    const socket = connect({ path: socketPath });
    let buffer = "";
    socket.on("connect", () => {
      socket.write(`${JSON.stringify(msg)}
`);
    });
    socket.on("data", (data) => {
      buffer += data.toString();
      const idx = buffer.indexOf(`
`);
      if (idx !== -1) {
        const line = buffer.slice(0, idx);
        socket.end();
        try {
          resolve(JSON.parse(line));
        } catch {
          reject(new Error(`Invalid JSON from benchd: ${line}`));
        }
      }
    });
    socket.on("error", (err) => reject(err));
    socket.on("close", () => {
      if (!buffer.includes(`
`)) {
        reject(new Error("Connection closed before response"));
      }
    });
  });
}
async function run() {
  const command = process.env.BENCH_COMMAND;
  if (!command) {
    console.log("::error::BENCH_COMMAND is required");
    process.exitCode = 1;
    return;
  }
  let jobToken = "";
  try {
    jobToken = readFileSync(JOB_TOKEN_PATH, "utf-8").trim();
  } catch {
    console.log("::error::Could not read job token. Ensure the noron job-started hook is configured.");
    process.exitCode = 1;
    return;
  }
  if (!jobToken) {
    console.log("::error::Job token is empty. Ensure the noron job-started hook is configured.");
    process.exitCode = 1;
    return;
  }
  const targetTemp = Number.parseInt(process.env.BENCH_TARGET_TEMP ?? "0", 10);
  const timeoutSec = Number.parseInt(process.env.BENCH_TIMEOUT ?? "300", 10);
  try {
    const checkin = await sendRequest(SOCKET_PATH, {
      type: "action.checkin",
      requestId: crypto.randomUUID(),
      jobToken
    });
    if (checkin.type === "error") {
      console.log(`::error::Action checkin failed: ${checkin.message}`);
      process.exitCode = 1;
      return;
    }
    console.log("Noron action registered with benchd");
  } catch (err) {
    console.log(`::error::Could not reach benchd for action checkin: ${err}`);
    process.exitCode = 1;
    return;
  }
  let cores = process.env.BENCH_CORES ?? "";
  let benchTmpfs = "";
  if (!cores) {
    try {
      const configResp = await sendRequest(SOCKET_PATH, {
        type: "config.get",
        requestId: crypto.randomUUID()
      });
      if (configResp.type === "config.get" && Array.isArray(configResp.isolatedCores)) {
        cores = configResp.isolatedCores.join(",");
        benchTmpfs = configResp.benchTmpfs ?? "";
        console.log(`Auto-detected isolated cores from benchd: ${cores}`);
        if (benchTmpfs)
          console.log(`Benchmark tmpfs: ${benchTmpfs}`);
      } else {
        console.log("::warning::Could not get core config from benchd, using fallback 1,2,3");
        cores = "1,2,3";
      }
    } catch {
      console.log("::warning::Could not reach benchd for core config, using fallback 1,2,3");
      cores = "1,2,3";
    }
  }
  console.log(`::group::Thermal stabilization (target: ${targetTemp === 0 ? "auto" : `${targetTemp}°C`})`);
  try {
    const thermal = await sendRequest(SOCKET_PATH, {
      type: "thermal.wait",
      requestId: crypto.randomUUID(),
      jobToken,
      targetTemp,
      timeout: timeoutSec * 1000
    });
    if (thermal.type === "thermal.timeout") {
      console.log(`::warning::Thermal stabilization timed out at ${thermal.currentTemp}°C (target: ${targetTemp}°C)`);
    } else if (thermal.type === "thermal.ready") {
      console.log(`CPU temperature stable at ${thermal.currentTemp}°C`);
    } else if (thermal.type === "error") {
      console.log(`::warning::Thermal check error: ${thermal.message}`);
    }
  } catch (err) {
    console.log(`::warning::Could not reach benchd for thermal check: ${err}`);
  }
  console.log("::endgroup::");
  console.log("::group::Benchmark isolation setup");
  let sessionId = "";
  try {
    const exec = await sendRequest(SOCKET_PATH, {
      type: "exec.prepare",
      requestId: crypto.randomUUID(),
      jobToken,
      cores: cores.split(",").map(Number),
      priority: -20
    });
    if (exec.type === "exec.ready") {
      sessionId = exec.sessionId;
      console.log(`Cgroup: ${exec.cgroupPath}`);
      console.log(`Session: ${sessionId}`);
    } else {
      console.log(`::error::Cgroup setup failed: ${JSON.stringify(exec)}`);
      console.log("::endgroup::");
      process.exitCode = 1;
      return;
    }
  } catch (err) {
    console.log(`::error::Could not reach benchd for exec setup: ${err}`);
    console.log("::endgroup::");
    process.exitCode = 1;
    return;
  }
  console.log("::endgroup::");
  const cwd = process.cwd();
  const benchEnv = {
    ...process.env,
    BENCH_SESSION_ID: sessionId,
    BENCH_JOB_TOKEN: jobToken,
    ...process.env.BENCH_OUTPUT ? { BENCH_OUTPUT: __require("path").resolve(cwd, process.env.BENCH_OUTPUT) } : {}
  };
  const useTmpfs = process.env.BENCH_USE_TMPFS !== "false";
  if (benchTmpfs && useTmpfs) {
    benchEnv.TMPDIR = benchTmpfs;
    benchEnv.BENCH_TMPFS = benchTmpfs;
    console.log(`Using tmpfs at ${benchTmpfs} for benchmark I/O (TMPDIR set automatically)`);
    console.log("All temp file operations will use RAM-backed storage for consistent I/O latency.");
  } else if (!useTmpfs) {
    console.log("Tmpfs disabled for this run (use-tmpfs: false). Benchmark I/O will use disk.");
  } else {
    console.log("::notice::No tmpfs available — benchmark I/O will use disk. For lower variance, configure tmpfs in /etc/benchd/config.toml (requires sufficient RAM).");
  }
  const usePerfStat = process.env.BENCH_PERF_STAT === "true";
  const perfStatOutput = benchTmpfs ? `${benchTmpfs}/perf-stat.tsv` : "/tmp/bench-perf-stat.tsv";
  const perfStatJson = perfStatOutput.replace(/\.\w+$/, ".json");
  console.log(`::group::Benchmark: ${command}`);
  const exitCode = await new Promise((resolve) => {
    const benchExecArgs = [
      "/usr/local/bin/bench-exec",
      "--cores",
      cores,
      "--nice=-20",
      "--ionice",
      "1"
    ];
    if (usePerfStat) {
      benchExecArgs.push("--perf-stat", "--perf-stat-output", perfStatOutput);
    }
    benchExecArgs.push("--", ...command.split(" "));
    const child = spawn("sudo", ["--preserve-env=BENCH_SESSION_ID,BENCH_JOB_TOKEN,BENCHD_SOCKET,BENCH_OUTPUT,BENCH_RUNNER,BENCH_RUN_INDEX,TMPDIR,BENCH_TMPFS", ...benchExecArgs], {
      stdio: "inherit",
      env: benchEnv
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", (err) => {
      console.error(`::error::Failed to spawn bench-exec: ${err.message}`);
      resolve(1);
    });
  });
  console.log("::endgroup::");
  if (exitCode !== 0) {
    console.log(`::error::Benchmark exited with code ${exitCode}`);
    process.exitCode = exitCode;
  }
  if (usePerfStat) {
    console.log("::group::Perf stat");
    try {
      const perfJson = JSON.parse(readFileSync(perfStatJson, "utf-8"));
      const healthy = perfJson.isolationHealthy;
      const ctxSw = perfJson.contextSwitches;
      const cpuMig = perfJson.cpuMigrations;
      console.log(`Isolation: ${healthy ? "HEALTHY" : "WARNING"}` + `  (context-switches: ${ctxSw}, cpu-migrations: ${cpuMig})`);
      if (perfJson.ipc != null) {
        console.log(`IPC: ${perfJson.ipc.toFixed(2)} instructions/cycle`);
      }
      if (perfJson.branchMissRate != null) {
        console.log(`Branch miss rate: ${perfJson.branchMissRate.toFixed(2)}%`);
      }
      if (perfJson.l1MissRate != null) {
        console.log(`L1 dcache miss rate: ${perfJson.l1MissRate.toFixed(2)}%`);
      }
      if (!healthy) {
        console.log(`::warning::CPU isolation may be compromised: context-switches=${ctxSw}, cpu-migrations=${cpuMig}`);
      }
      const githubOutput = process.env.GITHUB_OUTPUT;
      if (githubOutput) {
        appendFileSync(githubOutput, `perf-stat-json=${perfStatJson}
`);
      }
    } catch (err) {
      console.log(`::warning::Could not read perf stat results: ${err}`);
    }
    console.log("::endgroup::");
  }
}
run().catch((err) => {
  console.error(`::error::${err}`);
  process.exitCode = 1;
});
