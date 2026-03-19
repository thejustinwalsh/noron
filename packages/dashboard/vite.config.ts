import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { mockBenchd } from "./vite-mock-plugin";

const apiUrl = process.env.BENCH_API_URL ?? "http://localhost:9216";
const useMock = process.env.BENCH_MOCK === "true";

export default defineConfig({
	plugins: [react(), ...(useMock ? [mockBenchd()] : [])],
	base: "/dashboard/",
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
	server: {
		...(useMock
			? {}
			: {
					proxy: {
						"/api": apiUrl,
						"/ws": {
							target: apiUrl.replace("http", "ws"),
							ws: true,
						},
					},
				}),
	},
});
