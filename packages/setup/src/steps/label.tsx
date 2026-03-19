import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import type { SetupConfig } from "../generate";

interface LabelProps {
	config: Partial<SetupConfig>;
	onUpdate: (partial: Partial<SetupConfig>) => void;
	onNext: () => void;
}

const LABEL_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export function Label({ config, onUpdate, onNext }: LabelProps) {
	const [label, setLabel] = useState(config.runnerLabel ?? "noron");
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = (value: string) => {
		if (!LABEL_PATTERN.test(value)) {
			setError("Must be 1-64 characters: alphanumeric, dashes, underscores only");
			return;
		}
		setError(null);
		onUpdate({ runnerLabel: value });
		onNext();
	};

	return (
		<Box flexDirection="column" gap={1}>
			<Text bold>Runner Label</Text>
			<Text color="gray">
				This label is used in your GitHub Actions workflow `runs-on` directive to target this
				appliance.
			</Text>

			<Box flexDirection="column" paddingLeft={2}>
				<Box>
					<Text color="green">Label: </Text>
					<TextInput value={label} onChange={setLabel} onSubmit={handleSubmit} />
				</Box>
			</Box>

			{error && <Text color="red">{error}</Text>}
		</Box>
	);
}
