export interface SignupApplication {
	email: string;
	name: string | null;
	company: string | null;
	projectType: string;
	githubUrl: string | null;
	useCase: string;
	ip: string | null;
	userAgent: string | null;
}

export type SignupNotifier = (application: SignupApplication) => Promise<void>;

interface CloudflareEmailConfig {
	accountId: string;
	apiToken: string;
	from: string;
	to: string;
}

export function createSignupNotifierFromEnv(
	env: Record<string, string | undefined>,
): SignupNotifier {
	const accountId = env.CLOUDFLARE_ACCOUNT_ID;
	const apiToken = env.CLOUDFLARE_API_TOKEN;
	const from = env.SIGNUP_NOTIFY_FROM;
	const to = env.SIGNUP_NOTIFY_TO;

	if (!accountId || !apiToken || !from || !to) {
		return async () => {};
	}

	return createCloudflareSignupNotifier({ accountId, apiToken, from, to });
}

export function createCloudflareSignupNotifier(config: CloudflareEmailConfig): SignupNotifier {
	return async (application) => {
		const response = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/email/sending/send`,
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${config.apiToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					from: config.from,
					to: config.to,
					subject: `Noron signup: ${application.company ?? application.email}`,
					text: renderSignupEmail(application),
				}),
			},
		);

		if (!response.ok) {
			throw new Error(`Cloudflare email notification failed with status ${response.status}`);
		}
	};
}

export function renderSignupEmail(application: SignupApplication): string {
	return [
		"New Noron signup request",
		"",
		`Email: ${application.email}`,
		`Name: ${application.name ?? "-"}`,
		`Company/project: ${application.company ?? "-"}`,
		`Use type: ${application.projectType}`,
		`GitHub URL: ${application.githubUrl ?? "-"}`,
		"",
		"Use case:",
		application.useCase,
		"",
		"Request metadata:",
		`IP: ${application.ip ?? "-"}`,
		`User agent: ${application.userAgent ?? "-"}`,
	].join("\n");
}
