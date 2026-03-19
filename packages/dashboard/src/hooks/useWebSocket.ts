import { useCallback, useEffect, useRef, useState } from "react";
import type { StatusUpdate, ThermalHistory, WsMessage } from "../types";

const MAX_HISTORY = 300; // 5 minutes at 1Hz

export interface WebSocketState {
	status: StatusUpdate | null;
	thermalHistory: number[];
	cpuHistory: number[];
	memoryHistory: number[];
	connected: boolean;
}

export function useWebSocket(): WebSocketState {
	const [status, setStatus] = useState<StatusUpdate | null>(null);
	const [thermalHistory, setThermalHistory] = useState<number[]>([]);
	const [cpuHistory, setCpuHistory] = useState<number[]>([]);
	const [memoryHistory, setMemoryHistory] = useState<number[]>([]);
	const [connected, setConnected] = useState(false);
	const wsRef = useRef<WebSocket | null>(null);
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();

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
						return next.length > MAX_HISTORY
							? next.slice(next.length - MAX_HISTORY)
							: next;
					});
					setCpuHistory((prev) => {
						const next = [...prev, update.cpu ?? 0];
						return next.length > MAX_HISTORY
							? next.slice(next.length - MAX_HISTORY)
							: next;
					});
					setMemoryHistory((prev) => {
						const next = [...prev, update.memory?.percent ?? 0];
						return next.length > MAX_HISTORY
							? next.slice(next.length - MAX_HISTORY)
							: next;
					});
				}
			} catch {
				// Ignore malformed messages
			}
		};

		ws.onclose = () => {
			setConnected(false);
			wsRef.current = null;
			// Reconnect after 3 seconds
			reconnectTimerRef.current = setTimeout(connect, 3000);
		};

		ws.onerror = () => {
			ws.close();
		};
	}, []);

	useEffect(() => {
		connect();
		return () => {
			clearTimeout(reconnectTimerRef.current);
			wsRef.current?.close();
		};
	}, [connect]);

	return { status, thermalHistory, cpuHistory, memoryHistory, connected };
}
