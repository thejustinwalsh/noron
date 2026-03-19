import { DEFAULT_WEB_PORT } from "@noron/shared";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import React, { useState } from "react";
import type { SetupConfig } from "../generate";

interface OAuthProps {
	config: Partial<SetupConfig>;
	onUpdate: (partial: Partial<SetupConfig>) => void;
	onNext: () => void;
}

type Field = "clientId" | "clientSecret";

export function OAuth({ config, onUpdate, onNext }: OAuthProps) {
	const [field, setField] = useState<Field>("clientId");
	const [clientId, setClientId] = useState(config.githubClientId ?? "");
	const [clientSecret, setClientSecret] = useState(config.githubClientSecret ?? "");

	useInput((_input, key) => {
		if (key.return && field === "clientSecret" && clientId && clientSecret) {
			onUpdate({ githubClientId: clientId, githubClientSecret: clientSecret });
			onNext();
		}
	});

	const handleSubmitClientId = (value: string) => {
		setClientId(value);
		setField("clientSecret");
	};

	const handleSubmitClientSecret = (value: string) => {
		setClientSecret(value);
		onUpdate({ githubClientId: clientId, githubClientSecret: value });
		onNext();
	};

	return (
		<Box flexDirection="column" gap={1}>
			<Text bold>GitHub OAuth App</Text>
			<Text color="gray">
				Users sign in via GitHub OAuth. Create an OAuth App at github.com/settings/developers.
			</Text>
			<Text color="gray">
				Homepage URL: http://{"<hostname>"}:{config.webPort ?? DEFAULT_WEB_PORT}
			</Text>
			<Text color="gray">
				Callback URL: http://{"<hostname>"}:{config.webPort ?? DEFAULT_WEB_PORT}/auth/callback
			</Text>

			<Box flexDirection="column" paddingLeft={2}>
				<Box>
					<Text color={field === "clientId" ? "green" : "gray"}>Client ID: </Text>
					{field === "clientId" ? (
						<TextInput value={clientId} onChange={setClientId} onSubmit={handleSubmitClientId} />
					) : (
						<Text>{clientId}</Text>
					)}
				</Box>
				<Box>
					<Text color={field === "clientSecret" ? "green" : "gray"}>Client Secret: </Text>
					{field === "clientSecret" ? (
						<TextInput
							value={clientSecret}
							onChange={setClientSecret}
							onSubmit={handleSubmitClientSecret}
							mask="*"
						/>
					) : (
						<Text color="gray">{"(press Enter on Client ID first)"}</Text>
					)}
				</Box>
			</Box>

			{field === "clientSecret" && clientId && (
				<Text color="gray">Press Enter after entering the secret to continue...</Text>
			)}
		</Box>
	);
}
