#!/usr/bin/env bun
import { render } from "ink";
import React from "react";
import { Wizard } from "./wizard";

if (process.getuid && process.getuid() !== 0) {
	console.error("bench-setup must be run as root");
	process.exit(1);
}

render(React.createElement(Wizard));
