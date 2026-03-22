import { WaCard, WaIcon } from "@awesome.me/webawesome/dist/react";
import { useConfig } from "../hooks/useApi";

interface SystemInfoProps {
	uptime: number;
}

function formatUptime(ms: number): string {
	const hours = Math.floor(ms / 3_600_000);
	const minutes = Math.floor((ms % 3_600_000) / 60_000);
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

export function SystemInfo({ uptime }: SystemInfoProps) {
	const { config } = useConfig();

	return (
		<WaCard>
			<div className="system-info">
				<h3>
					<WaIcon name="server" family="classic" variant="solid" style={{ marginRight: "6px" }} />
					System
				</h3>
				<div className="info-row">
					<span className="label">Uptime</span>
					<span className="value">{formatUptime(uptime)}</span>
				</div>
				{config && (
					<>
						<div className="info-row">
							<span className="label">Total Cores</span>
							<span className="value">{config.totalCores}</span>
						</div>
						<div className="info-row">
							<span className="label">Housekeeping</span>
							<span className="value">Core {config.housekeepingCore}</span>
						</div>
						<div className="info-row">
							<span className="label">Isolated</span>
							<span className="value">Cores {config.isolatedCores.join(", ")}</span>
						</div>
					</>
				)}
				{config?.thermalZones && config.thermalZones.length > 0 && (
					<div className="info-row">
						<span className="label">Thermal Zones</span>
						<span className="value">{config.thermalZones.join(", ")}</span>
					</div>
				)}
			</div>
		</WaCard>
	);
}
