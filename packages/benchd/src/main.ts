import {
	SOCKET_PATH,
	CONFIG_PATH,
	DEFAULT_CONFIG,
	loadConfig,
	writeDefaultConfig,
	detectCpuTopology,
} from "@noron/shared";
import { BenchdServer } from "./server";
import { log } from "./logger";

const configPath = process.env.BENCHD_CONFIG ?? CONFIG_PATH;
const socketPath = process.env.BENCHD_SOCKET ?? SOCKET_PATH;
const logLevel = process.env.BENCHD_LOG_LEVEL ?? "info";

// Detect CPU topology
const topology = detectCpuTopology();
log("info", "startup", `Detected ${topology.totalCores} CPU cores`, {
	online: topology.onlineCores,
	recommended: {
		housekeeping: topology.recommendedHousekeeping,
		isolated: topology.recommendedIsolated,
	},
});

// Load or generate config
let config = loadConfig(configPath);
if (!config) {
	config = {
		...DEFAULT_CONFIG,
		isolatedCores: topology.recommendedIsolated,
		housekeepingCore: topology.recommendedHousekeeping,
		socketPath,
	};
	try {
		writeDefaultConfig(configPath, config);
		log("info", "startup", `Generated default config at ${configPath}`);
	} catch (err) {
		log("warn", "startup", `Could not write config to ${configPath}: ${err}`);
	}
} else {
	log("info", "startup", `Loaded config from ${configPath}`, {
		isolatedCores: config.isolatedCores,
		housekeepingCore: config.housekeepingCore,
	});
}

// Allow env to override socket path
config.socketPath = socketPath;

const server = new BenchdServer({ socketPath, logLevel, config, topology, configPath });

process.on("SIGTERM", () => server.shutdown());
process.on("SIGINT", () => server.shutdown());

await server.start();
