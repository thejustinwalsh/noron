import { useEffect, useRef } from "react";

export interface GradientStop {
	offset: number; // 0–1 position on Y axis (0 = bottom/min, 1 = top/max)
	color: string;
}

interface SparklineChartProps {
	data: number[];
	color: string;
	/** Vertical gradient stops for the fill area. If provided, also tints the line. */
	gradient?: GradientStop[];
	min?: number;
	max?: number;
	height?: number;
}

function lerpColor(stops: GradientStop[], t: number): string {
	if (stops.length === 0) return "#fff";
	if (t <= stops[0].offset) return stops[0].color;
	if (t >= stops[stops.length - 1].offset) return stops[stops.length - 1].color;
	for (let i = 0; i < stops.length - 1; i++) {
		if (t >= stops[i].offset && t <= stops[i + 1].offset) {
			return stops[i + 1].color; // snap to nearest stop
		}
	}
	return stops[0].color;
}

export function SparklineChart({
	data,
	color,
	gradient,
	min: fixedMin,
	max: fixedMax,
	height = 56,
}: SparklineChartProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const animRef = useRef<number>(0);
	const prevDataRef = useRef<number[]>([]);
	const drawnRef = useRef(false);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const prevData = prevDataRef.current;
		const startTime = performance.now();
		const duration = 300;

		function draw(now: number) {
			const ctx = canvas?.getContext("2d");
			if (!ctx) return;

			const t = Math.min((now - startTime) / duration, 1);
			const ease = 1 - (1 - t) * (1 - t) * (1 - t);

			const dpr = window.devicePixelRatio || 1;
			const rect = canvas?.getBoundingClientRect();
			if (!canvas || !rect) return;
			canvas.width = rect.width * dpr;
			canvas.height = rect.height * dpr;
			ctx.scale(dpr, dpr);

			const w = rect.width;
			const h = rect.height;

			ctx.clearRect(0, 0, w, h);

			if (data.length < 2) {
				prevDataRef.current = [...data];
				animRef.current = 0;
				return;
			}

			// When the buffer is full and a new point is appended, the oldest is
			// dropped, shifting every index by 1.  Offset the prevData lookup so
			// existing points keep their Y value and only the new tail animates.
			const isScrolling =
				prevData.length > 1 && data.length === prevData.length;
			const offset = isScrolling ? 1 : 0;

			const interp: number[] = [];
			for (let i = 0; i < data.length; i++) {
				const prevIdx = i + offset;
				if (prevIdx < prevData.length) {
					// Existing point that shifted position — no Y animation
					interp.push(data[i]);
				} else {
					// New tail point — animate from previous last value
					const fromVal =
						prevData.length > 0
							? prevData[prevData.length - 1]
							: data[i];
					interp.push(fromVal + (data[i] - fromVal) * ease);
				}
			}

			// Use final data for scale so the Y axis doesn't wobble mid-animation
			const lo = fixedMin ?? Math.min(...data);
			const hi = fixedMax ?? Math.max(...data);
			const range = hi - lo || 1;
			const pad = 7; // enough for dot (3px) + glow (6px radius)

			const toX = (i: number) => pad + (i / (interp.length - 1)) * (w - pad * 2);
			const toY = (v: number) => pad + (1 - (v - lo) / range) * (h - pad * 2);

			// Build path
			ctx.beginPath();
			ctx.moveTo(toX(0), toY(interp[0]));
			for (let i = 1; i < interp.length; i++) {
				ctx.lineTo(toX(i), toY(interp[i]));
			}

			// Fill gradient
			if (gradient && gradient.length > 1) {
				// Heatmap: vertical gradient mapped to data range
				const fillGrad = ctx.createLinearGradient(0, toY(hi), 0, toY(lo));
				for (const stop of gradient) {
					fillGrad.addColorStop(1 - stop.offset, `${stop.color}35`);
				}
				// Close fill path
				ctx.lineTo(toX(interp.length - 1), h);
				ctx.lineTo(toX(0), h);
				ctx.closePath();
				ctx.fillStyle = fillGrad;
				ctx.fill();

				// Stroke with gradient too
				ctx.beginPath();
				ctx.moveTo(toX(0), toY(interp[0]));
				for (let i = 1; i < interp.length; i++) {
					ctx.lineTo(toX(i), toY(interp[i]));
				}
				const lineGrad = ctx.createLinearGradient(0, toY(hi), 0, toY(lo));
				for (const stop of gradient) {
					lineGrad.addColorStop(1 - stop.offset, stop.color);
				}
				ctx.strokeStyle = lineGrad;
			} else {
				// Simple single-color fill
				const grad = ctx.createLinearGradient(0, 0, 0, h);
				grad.addColorStop(0, `${color}30`);
				grad.addColorStop(1, `${color}00`);
				ctx.lineTo(toX(interp.length - 1), h);
				ctx.lineTo(toX(0), h);
				ctx.closePath();
				ctx.fillStyle = grad;
				ctx.fill();

				// Stroke
				ctx.beginPath();
				ctx.moveTo(toX(0), toY(interp[0]));
				for (let i = 1; i < interp.length; i++) {
					ctx.lineTo(toX(i), toY(interp[i]));
				}
				ctx.strokeStyle = color;
			}

			ctx.lineWidth = 1.5;
			ctx.lineJoin = "round";
			ctx.stroke();

			// Glowing endpoint
			const lastX = toX(interp.length - 1);
			const lastY = toY(interp[interp.length - 1]);
			const lastVal = interp[interp.length - 1];
			const dotColor = gradient ? lerpColor(gradient, (lastVal - lo) / range) : color;

			ctx.beginPath();
			ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
			ctx.fillStyle = dotColor;
			ctx.fill();
			ctx.beginPath();
			ctx.arc(lastX, lastY, 6, 0, Math.PI * 2);
			ctx.fillStyle = `${dotColor}30`;
			ctx.fill();

			if (t < 1) {
				animRef.current = requestAnimationFrame(draw);
			} else {
				animRef.current = 0;
				prevDataRef.current = [...data];
			}
		}

		animRef.current = requestAnimationFrame(draw);
		return () => {
			if (animRef.current) cancelAnimationFrame(animRef.current);
		};
	}, [data, color, gradient, fixedMin, fixedMax]);

	useEffect(() => {
		return () => {
			prevDataRef.current = [...data];
		};
	}, [data]);

	return (
		<canvas
			ref={canvasRef}
			style={{
				width: "100%",
				height: `${height}px`,
				borderRadius: "6px",
			}}
		/>
	);
}
