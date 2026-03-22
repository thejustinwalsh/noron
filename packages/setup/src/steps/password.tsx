import { execSync } from "node:child_process";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import React, { useState } from "react";

interface PasswordProps {
	onNext: () => void;
}

export function Password({ onNext }: PasswordProps) {
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [phase, setPhase] = useState<"enter" | "confirm" | "done">("enter");
	const [error, setError] = useState("");

	const handleSubmitPassword = (value: string) => {
		if (value.length < 6) {
			setError("Password must be at least 6 characters");
			setPassword("");
			return;
		}
		setError("");
		setPhase("confirm");
	};

	const handleSubmitConfirm = (value: string) => {
		if (value !== password) {
			setError("Passwords do not match");
			setConfirm("");
			setPhase("enter");
			setPassword("");
			return;
		}
		setError("");
		try {
			execSync(`echo "bench:${password}" | chpasswd`, { stdio: "pipe" });
			setPhase("done");
			onNext();
		} catch {
			setError("Failed to set password");
			setPhase("enter");
			setPassword("");
			setConfirm("");
		}
	};

	return (
		<Box flexDirection="column" gap={1}>
			<Text>
				Set a password for the <Text bold>bench</Text> user account.
			</Text>
			<Text color="gray">This is how you'll log in via SSH and the console.</Text>

			{error && <Text color="red">{error}</Text>}

			{phase === "enter" && (
				<Box>
					<Text>Password: </Text>
					<TextInput
						value={password}
						onChange={setPassword}
						onSubmit={handleSubmitPassword}
						mask="*"
					/>
				</Box>
			)}

			{phase === "confirm" && (
				<Box>
					<Text>Confirm: </Text>
					<TextInput
						value={confirm}
						onChange={setConfirm}
						onSubmit={handleSubmitConfirm}
						mask="*"
					/>
				</Box>
			)}
		</Box>
	);
}
