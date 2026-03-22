#!/usr/bin/env bun
import { existsSync, unlinkSync } from "node:fs";
import { render } from "ink";
import React from "react";
import { Wizard } from "./wizard";

if (process.getuid && process.getuid() !== 0) {
	console.error("bench-setup must be run as root (use sudo)");
	process.exit(1);
}

const SETUP_COMPLETE = "/var/lib/bench/.setup-complete";
const isReconfigure = process.argv.includes("--reconfigure");

if (isReconfigure) {
	if (existsSync(SETUP_COMPLETE)) {
		unlinkSync(SETUP_COMPLETE);
	}
	console.log("Re-running setup wizard...\n");
}

const isFirstRun = !isReconfigure && !existsSync(SETUP_COMPLETE);

render(React.createElement(Wizard, { isFirstRun }));
