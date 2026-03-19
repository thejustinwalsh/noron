import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { detectCpuTopology, type CpuTopology, type ThermalZoneInfo } from "@noron/shared";

export interface HardwareProfile {
	cpu: CpuTopology;
	memory: { totalMB: number; availableMB: number };
	network: NetworkInterface[];
	platform: "sbc" | "desktop" | "server" | "vm" | "unknown";
	hostname: string;
}

interface NetworkInterface {
	name: string;
	address: string;
}

function detectMemory(): { totalMB: number; availableMB: number } {
	try {
		const meminfo = readFileSync("/proc/meminfo", "utf-8");
		const total = meminfo.match(/MemTotal:\s+(\d+)/);
		const available = meminfo.match(/MemAvailable:\s+(\d+)/);
		return {
			totalMB: total ? Math.round(Number(total[1]) / 1024) : 0,
			availableMB: available ? Math.round(Number(available[1]) / 1024) : 0,
		};
	} catch {
		const { totalmem, freemem } = require("node:os");
		return {
			totalMB: Math.round(totalmem() / 1024 / 1024),
			availableMB: Math.round(freemem() / 1024 / 1024),
		};
	}
}

function detectNetwork(): NetworkInterface[] {
	try {
		const { networkInterfaces } = require("node:os");
		const ifaces = networkInterfaces();
		const result: NetworkInterface[] = [];
		for (const [name, addrs] of Object.entries(ifaces)) {
			if (name === "lo") continue;
			const ipv4 = (addrs as Array<{ family: string; address: string }>)?.find(
				(a) => a.family === "IPv4",
			);
			if (ipv4) {
				result.push({ name, address: ipv4.address });
			}
		}
		return result;
	} catch {
		return [];
	}
}

function detectPlatform(): "sbc" | "desktop" | "server" | "vm" | "unknown" {
	// Check for SBC (Raspberry Pi, etc.)
	if (existsSync("/sys/firmware/devicetree")) return "sbc";

	// Check for VM
	try {
		const virt = execSync("systemd-detect-virt 2>/dev/null", { encoding: "utf-8" }).trim();
		if (virt && virt !== "none") return "vm";
	} catch {
		// systemd-detect-virt not available or returned non-zero
	}

	// Check DMI for server indicators
	try {
		const product = readFileSync("/sys/class/dmi/id/product_name", "utf-8").trim().toLowerCase();
		if (product.includes("server") || product.includes("poweredge") || product.includes("proliant")) {
			return "server";
		}
	} catch {
		// Not available
	}

	return "desktop";
}

function getHostname(): string {
	try {
		return require("node:os").hostname();
	} catch {
		return "bench-runner";
	}
}

export function detectHardware(): HardwareProfile {
	return {
		cpu: detectCpuTopology(),
		memory: detectMemory(),
		network: detectNetwork(),
		platform: detectPlatform(),
		hostname: getHostname(),
	};
}
