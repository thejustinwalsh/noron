import { useCallback, useEffect, useState } from "react";

interface AuthState {
	login: string | null;
	authenticated: boolean;
	loading: boolean;
}

export function useAuth(): AuthState & { logout: () => void } {
	const [state, setState] = useState<AuthState>(() => {
		const login = localStorage.getItem("bench_login");
		// If we have a cached login, assume authenticated (cookie will be validated server-side)
		// Mark as loading until the server confirms
		return { login, authenticated: !!login, loading: true };
	});

	// Check auth status on mount by calling the /api/auth/me endpoint
	useEffect(() => {
		// Migrate: clear legacy token from localStorage if present
		localStorage.removeItem("bench_token");

		fetch("/api/auth/me", { credentials: "same-origin" })
			.then((res) => {
				if (res.ok) return res.json();
				throw new Error("Not authenticated");
			})
			.then((data: { login?: string }) => {
				const login = data.login ?? null;
				if (login) localStorage.setItem("bench_login", login);
				setState({ login, authenticated: true, loading: false });
			})
			.catch(() => {
				localStorage.removeItem("bench_login");
				setState({ login: null, authenticated: false, loading: false });
			});
	}, []);

	const logout = useCallback(() => {
		fetch("/auth/logout", { method: "POST", credentials: "same-origin" }).finally(() => {
			localStorage.removeItem("bench_login");
			setState({ login: null, authenticated: false, loading: false });
		});
	}, []);

	return { ...state, logout };
}
