import { describe, expect, test } from "bun:test";
import { splitCommand } from "../split-command";

describe("splitCommand", () => {
	test("splits simple command", () => {
		expect(splitCommand("bun run test")).toEqual(["bun", "run", "test"]);
	});

	test("handles double-quoted arguments", () => {
		expect(splitCommand('bun run "my script.js"')).toEqual(["bun", "run", "my script.js"]);
	});

	test("handles single-quoted arguments", () => {
		expect(splitCommand("bun run 'my script.js'")).toEqual(["bun", "run", "my script.js"]);
	});

	test("handles mixed quotes", () => {
		expect(splitCommand('echo "hello world" --flag')).toEqual(["echo", "hello world", "--flag"]);
	});

	test("collapses multiple spaces", () => {
		expect(splitCommand("bun  run   test")).toEqual(["bun", "run", "test"]);
	});

	test("returns empty array for empty string", () => {
		expect(splitCommand("")).toEqual([]);
	});

	test("handles tabs as whitespace", () => {
		expect(splitCommand("bun\trun\ttest")).toEqual(["bun", "run", "test"]);
	});

	test("preserves single quotes inside double quotes", () => {
		expect(splitCommand(`bun run "it's a test"`)).toEqual(["bun", "run", "it's a test"]);
	});

	test("preserves double quotes inside single quotes", () => {
		expect(splitCommand("bun run 'say \"hello\"'")).toEqual(["bun", "run", 'say "hello"']);
	});
});
