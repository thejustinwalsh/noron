#!/usr/bin/env bun
import { Builtins, Cli } from "clipanion";
import { LoginCommand } from "./commands/login";
import { MonitorCommand } from "./commands/monitor";
import { RunnersCommand } from "./commands/runners";
import { StatusCommand } from "./commands/status";
import {
	UpdateApplyCommand,
	UpdateCheckCommand,
	UpdateHistoryCommand,
	UpdateStatusCommand,
} from "./commands/update";

const cli = new Cli({
	binaryLabel: "bench",
	binaryName: "bench",
	binaryVersion: "0.1.0",
});

cli.register(LoginCommand);
cli.register(StatusCommand);
cli.register(MonitorCommand);
cli.register(RunnersCommand);
cli.register(UpdateStatusCommand);
cli.register(UpdateCheckCommand);
cli.register(UpdateApplyCommand);
cli.register(UpdateHistoryCommand);
cli.register(Builtins.HelpCommand);
cli.register(Builtins.VersionCommand);

cli.runExit(process.argv.slice(2));
