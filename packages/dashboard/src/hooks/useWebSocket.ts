import { useCallback, useEffect, useRef, useState } from "react";
import type { StatusUpdate, ThermalHistory, WsMessage } from "../types";

const MAX_HISTORY = 300; // 5 minutes at 1Hz

export interface WebSocketState {
	status: StatusUpdate | null;
	thermalHistory: number[];
	cpuHistory: number[];
	memoryHistory: number[];
	diskHistory: number[];
	connected: boolean;
}

export function useWebSocket(enabled = true): WebSocketState {
	const [status, setStatus] = useState<StatusUpdate | null>(null);
	const [thermalHistory, setThermalHistory] = useState<number[]>([]);
	const [cpuHistory, setCpuHistory] = useState<number[]>([]);
	const [memoryHistory, setMemoryHistory] = useState<number[]>([]);
	const [diskHistory, setDiskHistory] = useState<number[]>([]);
	const [connected, setConnected] = useState(false);
	const wsRef = useRef<WebSocket | null>(null);
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();
	const enabledRef = useRef(enabled);
	enabledRef.current = enabled;

	const connect = useCallback(() => {
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const wsUrl = `${protocol}//${window.location.host}/ws/status`;

		const ws = new WebSocket(wsUrl);
		wsRef.current = ws;

		ws.onopen = () => {
			setConnected(true);
		};

		ws.onmessage = (event) => {
			try {
				const msg = JSON.parse(event.data) as WsMessage;

				if (msg.type === "thermal.history") {
					const hist = msg as ThermalHistory;
					setThermalHistory(hist.history.slice(-MAX_HISTORY));
				} else if (msg.type === "status.update") {
					const update = msg as StatusUpdate;
					setStatus(update);
					setThermalHistory((prev) => {
						const next = [...prev, update.thermal.currentTemp];
						return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
					});
					setCpuHistory((prev) => {
						const next = [...prev, update.cpu ?? 0];
						return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
					});
					setMemoryHistory((prev) => {
						const next = [...prev, update.memory?.percent ?? 0];
						return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
					});
					setDiskHistory((prev) => {
						const next = [...prev, update.disk?.percent ?? 0];
						return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
					});
				}
			} catch {
				// Ignore malformed messages
			}
		};

		ws.onclose = () => {
			setConnected(false);
			wsRef.current = null;
			// Only reconnect if still enabled
			if (enabledRef.current) {
				reconnectTimerRef.current = setTimeout(connect, 3000);
			}
		};

		ws.onerror = () => {
			ws.close();
		};
	}, []);

	useEffect(() => {
		if (!enabled) {
			clearTimeout(reconnectTimerRef.current);
			wsRef.current?.close();
			wsRef.current = null;
			setConnected(false);
			return;
		}
		connect();
		return () => {
			clearTimeout(reconnectTimerRef.current);
			wsRef.current?.close();
		};
	}, [connect, enabled]);

	return { status, thermalHistory, cpuHistory, memoryHistory, diskHistory, connected };
}
