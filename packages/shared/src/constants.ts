/** Path to the benchd Unix domain socket */
export const SOCKET_PATH = "/run/benchd/benchd.sock";

/** Systemd slice for benchmark cgroups */
export const BENCHMARK_SLICE = "benchmark.slice";

/** Cgroup v2 path for benchmark processes */
export const BENCHMARK_CGROUP = "/sys/fs/cgroup/benchmark.slice";

/**
 * CPU cores reserved for benchmarks (set via isolcpus in GRUB).
 * @deprecated Use BenchdConfig.isolatedCores from config.toml instead.
 * Kept as a compile-time fallback for packages that haven't migrated.
 */
export const ISOLATED_CORES = [1, 2, 3] as const;

/**
 * CPU core for housekeeping (OS, runner overhead, non-benchmark steps).
 * @deprecated Use BenchdConfig.housekeepingCore from config.toml instead.
 * Kept as a compile-time fallback for packages that haven't migrated.
 */
export const HOUSEKEEPING_CORE = 0;

/** Default target temperature in Celsius before starting benchmarks */
export const DEFAULT_TARGET_TEMP_C = 45;

/** Number of thermal readings to keep in the ring buffer (5 min at 1Hz) */
export const THERMAL_HISTORY_SIZE = 300;

/** Thermal sensor polling interval */
export const THERMAL_POLL_INTERVAL_MS = 1000;

/** Default web server port */
export const DEFAULT_WEB_PORT = 9216;

/** Default invite link expiration */
export const TOKEN_EXPIRY_HOURS = 24;

/** Grace period before auto-releasing a lock on client disconnect */
export const LOCK_DISCONNECT_GRACE_MS = 5000;

/** Maximum time to wait for thermal stabilization (per LLVM guidelines) */
export const THERMAL_TIMEOUT_MS = 300_000; // 5 minutes

/** tmpfs mount point for benchmark I/O (LLVM guideline: avoid disk variance) */
export const BENCHMARK_TMPFS = "/mnt/bench-tmpfs";

/** Path to the runner-ctld Unix domain socket */
export const RUNNER_CTL_SOCKET_PATH = "/var/run/runner-ctl.sock";

/** Path where the job-started hook writes the job token for the action to read */
export const JOB_TOKEN_PATH = "/opt/actions-runner/.benchd-token";

/** Default maximum job duration (10 minutes) */
export const DEFAULT_JOB_TIMEOUT_MS = 600_000;

/** Number of violations before a runner is disabled */
export const VIOLATION_STRIKE_LIMIT = 3;

/** Window for counting violations (30 days in ms) */
export const VIOLATION_WINDOW_MS = 30 * 24 * 3600_000;
