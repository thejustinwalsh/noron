import { useEffect, useRef } from "react";

interface ThermalChartProps {
	history: number[];
	targetTemp: number;
}

const COLORS = {
	green: "#21ab52",
	yellow: "#d78000",
	red: "#e02c2b",
	target: "#1f9de2",
	grid: "#313134",
	text: "#94959b",
	bg: "#1d1d20",
};

function tempColor(temp: number): string {
	if (temp < 40) return COLORS.green;
	if (temp < 50) return COLORS.yellow;
	return COLORS.red;
}

export function ThermalChart({ history, targetTemp }: ThermalChartProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const dpr = window.devicePixelRatio || 1;
		const rect = canvas.getBoundingClientRect();
		canvas.width = rect.width * dpr;
		canvas.height = rect.height * dpr;
		ctx.scale(dpr, dpr);

		const w = rect.width;
		const h = rect.height;
		const padding = { top: 20, right: 16, bottom: 30, left: 45 };
		const plotW = w - padding.left - padding.right;
		const plotH = h - padding.top - padding.bottom;

		// Determine Y range
		const allTemps = history.length > 0 ? history : [0];
		const minTemp = Math.floor(Math.min(...allTemps, targetTemp - 5) / 5) * 5;
		const maxTemp = Math.ceil(Math.max(...allTemps, targetTemp + 10) / 5) * 5;
		const tempRange = maxTemp - minTemp || 1;

		const toX = (i: number) => padding.left + (i / Math.max(history.length - 1, 1)) * plotW;
		const toY = (temp: number) => padding.top + (1 - (temp - minTemp) / tempRange) * plotH;

		// Background
		ctx.fillStyle = COLORS.bg;
		ctx.fillRect(0, 0, w, h);

		// Grid lines
		ctx.strokeStyle = COLORS.grid;
		ctx.lineWidth = 0.5;
		for (let t = minTemp; t <= maxTemp; t += 5) {
			const y = toY(t);
			ctx.beginPath();
			ctx.moveTo(padding.left, y);
			ctx.lineTo(w - padding.right, y);
			ctx.stroke();

			// Y-axis labels
			ctx.fillStyle = COLORS.text;
			ctx.font = "11px system-ui";
			ctx.textAlign = "right";
			ctx.fillText(`${t}°`, padding.left - 6, y + 4);
		}

		// Target temperature line
		ctx.strokeStyle = COLORS.target;
		ctx.lineWidth = 1;
		ctx.setLineDash([6, 4]);
		const targetY = toY(targetTemp);
		ctx.beginPath();
		ctx.moveTo(padding.left, targetY);
		ctx.lineTo(w - padding.right, targetY);
		ctx.stroke();
		ctx.setLineDash([]);

		ctx.fillStyle = COLORS.target;
		ctx.font = "10px system-ui";
		ctx.textAlign = "left";
		ctx.fillText(`target ${targetTemp}°`, w - padding.right + 2, targetY - 4);

		// Temperature line
		if (history.length > 1) {
			ctx.lineWidth = 2;
			ctx.lineJoin = "round";
			ctx.beginPath();
			ctx.moveTo(toX(0), toY(history[0]));

			for (let i = 1; i < history.length; i++) {
				ctx.lineTo(toX(i), toY(history[i]));
			}

			// Gradient stroke based on last temp
			const lastTemp = history[history.length - 1];
			ctx.strokeStyle = tempColor(lastTemp);
			ctx.stroke();

			// Fill under the line with low opacity
			ctx.lineTo(toX(history.length - 1), toY(minTemp));
			ctx.lineTo(toX(0), toY(minTemp));
			ctx.closePath();
			ctx.fillStyle = `${tempColor(lastTemp)}15`;
			ctx.fill();
		}

		// X-axis label
		ctx.fillStyle = COLORS.text;
		ctx.font = "11px system-ui";
		ctx.textAlign = "center";
		ctx.fillText("5 min", w / 2, h - 4);
	}, [history, targetTemp]);

	return (
		<canvas
			ref={canvasRef}
			style={{
				width: "100%",
				height: "200px",
				borderRadius: "8px",
			}}
		/>
	);
}
