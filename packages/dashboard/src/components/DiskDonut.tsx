import { useEffect, useRef } from "react";

interface DiskDonutProps {
	usedGb: number;
	totalGb: number;
	percent: number;
	color: string;
}

export function DiskDonut({ usedGb, totalGb, percent, color }: DiskDonutProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const dpr = window.devicePixelRatio || 1;
		const rect = canvas.getBoundingClientRect();
		canvas.width = rect.width * dpr;
		canvas.height = rect.height * dpr;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const w = rect.width;
		const h = rect.height;
		if (w === 0 || h === 0) return;
		ctx.scale(dpr, dpr);
		const cx = w / 2;
		const cy = h / 2;
		const radius = Math.min(w, h) / 2 - 4;
		const lineWidth = 10;
		const innerRadius = radius - lineWidth;

		// Background track
		ctx.beginPath();
		ctx.arc(cx, cy, radius - lineWidth / 2, 0, Math.PI * 2);
		ctx.strokeStyle = "#21262d";
		ctx.lineWidth = lineWidth;
		ctx.lineCap = "round";
		ctx.stroke();

		// Used arc
		const usedAngle = (percent / 100) * Math.PI * 2;
		const startAngle = -Math.PI / 2;
		if (percent > 0) {
			ctx.beginPath();
			ctx.arc(cx, cy, radius - lineWidth / 2, startAngle, startAngle + usedAngle);
			ctx.strokeStyle = color;
			ctx.lineWidth = lineWidth;
			ctx.lineCap = "round";
			ctx.stroke();
		}

		// Center text
		const freeGb = totalGb - usedGb;
		ctx.fillStyle = "#f2f2f3";
		ctx.font = "600 16px system-ui, -apple-system, sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(`${freeGb.toFixed(0)} GB`, cx, cy - 6);

		ctx.fillStyle = "#94959b";
		ctx.font = "11px system-ui, -apple-system, sans-serif";
		ctx.fillText("free", cx, cy + 12);
	}, [usedGb, totalGb, percent, color]);

	return (
		<div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
			<canvas
				ref={canvasRef}
				style={{ width: "100px", height: "100px" }}
			/>
		</div>
	);
}
