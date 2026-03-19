import { WaButton, WaCard, WaIcon } from "@awesome.me/webawesome/dist/react";

export function LoginPrompt() {
	return (
		<WaCard>
			<div className="login-prompt">
				<WaIcon
					name="lock"
					family="classic"
					variant="solid"
					style={{ fontSize: "24px", color: "var(--text-muted)" }}
				/>
				<h3
					style={{
						color: "var(--text)",
						textTransform: "none",
						letterSpacing: "normal",
						fontSize: "16px",
					}}
				>
					Sign in required
				</h3>
				<p className="muted">You need to sign in with GitHub to access this page.</p>
				<WaButton
					variant="brand"
					onClick={() => {
						window.location.href = "/auth/login";
					}}
				>
					<WaIcon name="github" family="brands" variant="solid" slot="prefix" />
					Sign in with GitHub
				</WaButton>
			</div>
		</WaCard>
	);
}
