import { execSync } from "node:child_process";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import React, { useState } from "react";

interface TimezoneProps {
	onNext: () => void;
}

function detectTimezone(): string {
	try {
		return execSync("cat /etc/timezone 2>/dev/null || echo UTC", {
			encoding: "utf-8",
		}).trim();
	} catch {
		return "UTC";
	}
}

function getTimezoneList(): string[] {
	try {
		return execSync("timedatectl list-timezones 2>/dev/null", {
			encoding: "utf-8",
		})
			.trim()
			.split("\n");
	} catch {
		return [
			"UTC",
			"US/Eastern",
			"US/Central",
			"US/Mountain",
			"US/Pacific",
			"Europe/London",
			"Europe/Berlin",
			"Asia/Tokyo",
		];
	}
}

export function Timezone({ onNext }: TimezoneProps) {
	const [current] = useState(detectTimezone);
	const [input, setInput] = useState("");
	const [error, setError] = useState("");
	const [timezones] = useState(getTimezoneList);

	const matches =
		input.length >= 2
			? timezones.filter((tz) => tz.toLowerCase().includes(input.toLowerCase())).slice(0, 8)
			: [];

	useInput((_input, key) => {
		if (key.return && input === "") {
			// Accept current timezone
			onNext();
		}
	});

	const handleSubmit = (value: string) => {
		if (value === "") {
			onNext();
			return;
		}

		// Check for exact match or unique prefix match
		const exact = timezones.find((tz) => tz.toLowerCase() === value.toLowerCase());
		const target = exact ?? (matches.length === 1 ? matches[0] : null);

		if (!target) {
			setError(
				matches.length === 0
					? `No timezone matching "${value}"`
					: "Multiple matches — type more to narrow down",
			);
			return;
		}

		try {
			execSync(
				`timedatectl set-timezone "${target}" 2>/dev/null || ln -sf /usr/share/zoneinfo/${target} /etc/localtime`,
				{
					stdio: "pipe",
				},
			);
			setError("");
			onNext();
		} catch {
			setError(`Failed to set timezone to ${target}`);
		}
	};

	return (
		<Box flexDirection="column" gap={1}>
			<Text>
				Set your timezone. Current:{" "}
				<Text bold color="cyan">
					{current}
				</Text>
			</Text>
			<Text color="gray">
				Type to search, Enter to accept current, or type a timezone and Enter.
			</Text>

			{error && <Text color="red">{error}</Text>}

			<Box>
				<Text>Timezone: </Text>
				<TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
			</Box>

			{matches.length > 0 && (
				<Box flexDirection="column" paddingLeft={2}>
					{matches.map((tz) => (
						<Text key={tz} color="gray">
							{tz}
						</Text>
					))}
					{matches.length === 8 && <Text color="gray">...</Text>}
				</Box>
			)}
		</Box>
	);
}
