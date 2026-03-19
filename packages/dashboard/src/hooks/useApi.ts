import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ConfigInfo, GithubRepo, Invite, Runner, UserInfo, Violation, WorkflowCounts, WorkflowRun, StepAttempt } from "../types";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...(init?.headers as Record<string, string> ?? {}),
	};
	const res = await fetch(url, { ...init, headers, credentials: "same-origin" });
	if (!res.ok) {
		let message = `${res.status} ${res.statusText}`;
		try {
			const body = await res.json() as { error?: string };
			if (body.error) message = body.error;
		} catch {
			// response wasn't JSON — use status text
		}
		throw new Error(message);
	}
	return res.json() as Promise<T>;
}

export function useConfig() {
	const { data: config = null, isLoading: loading } = useQuery({
		queryKey: ["config"],
		queryFn: () => fetchJson<ConfigInfo>("/api/config"),
	});

	return { config, loading };
}

export function useRunners() {
	const queryClient = useQueryClient();

	const { data: runners = [], isLoading: loading, refetch } = useQuery({
		queryKey: ["runners"],
		queryFn: () => fetchJson<Runner[]>("/api/runners"),
	});

	const registerRunner = useMutation({
		mutationFn: ({ name, repo }: { name: string; repo: string }) =>
			fetchJson<Runner>("/api/runners", {
				method: "POST",
				body: JSON.stringify({ name, repo }),
			}),
		onMutate: async ({ name, repo }) => {
			await queryClient.cancelQueries({ queryKey: ["runners"] });
			const previous = queryClient.getQueryData<Runner[]>(["runners"]);
			queryClient.setQueryData<Runner[]>(["runners"], (old = []) => [
				{
					id: `optimistic-${Date.now()}`,
					name,
					repo,
					status: "pending",
					statusMessage: null,
					lastHeartbeat: null,
					job_timeout_ms: null,
					disabled_at: null,
					disabled_reason: null,
					violationCount: 0,
				},
				...old,
			]);
			return { previous };
		},
		onError: (_err, _vars, context) => {
			if (context?.previous) {
				queryClient.setQueryData(["runners"], context.previous);
			}
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: ["runners"] });
		},
	});

	const removeRunner = useMutation({
		mutationFn: (id: string) =>
			fetchJson<void>(`/api/runners/${id}`, { method: "DELETE" }),
		onMutate: async (id) => {
			await queryClient.cancelQueries({ queryKey: ["runners"] });
			const previous = queryClient.getQueryData<Runner[]>(["runners"]);
			queryClient.setQueryData<Runner[]>(["runners"], (old = []) =>
				old.filter((r) => r.id !== id),
			);
			return { previous };
		},
		onError: (_err, _id, context) => {
			if (context?.previous) {
				queryClient.setQueryData(["runners"], context.previous);
			}
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: ["runners"] });
		},
	});

	return { runners, loading, refetch, registerRunner, removeRunner };
}

export function useInvites() {
	const queryClient = useQueryClient();

	const { data: invites = [], isLoading: loading } = useQuery({
		queryKey: ["invites"],
		queryFn: () => fetchJson<Invite[]>("/api/invites"),
	});

	const createInvite = useMutation({
		mutationFn: () => fetchJson<Invite>("/api/invites", { method: "POST" }),
		onMutate: async () => {
			await queryClient.cancelQueries({ queryKey: ["invites"] });
			const previous = queryClient.getQueryData<Invite[]>(["invites"]);
			return { previous };
		},
		onSuccess: (newInvite) => {
			queryClient.setQueryData<Invite[]>(["invites"], (old = []) => [newInvite, ...old]);
		},
		onError: (_err, _vars, context) => {
			if (context?.previous) {
				queryClient.setQueryData(["invites"], context.previous);
			}
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: ["invites"] });
		},
	});

	return { invites, loading, createInvite };
}

const PER_PAGE = 100;

export function useGithubRepos(hasRepoScope?: boolean) {
	const { data, isLoading: loading, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
		useInfiniteQuery({
			queryKey: ["github", "repos"],
			queryFn: ({ pageParam }) =>
				fetchJson<GithubRepo[]>(`/api/github/repos?page=${pageParam}`),
			initialPageParam: 1,
			getNextPageParam: (lastPage, _allPages, lastPageParam) =>
				lastPage.length >= PER_PAGE ? lastPageParam + 1 : undefined,
			enabled: hasRepoScope !== false,
			staleTime: 10 * 60_000,
			gcTime: 30 * 60_000,
		});

	const repos = data?.pages.flat() ?? [];

	return { repos, loading, refetch, fetchNextPage, hasNextPage, isFetchingNextPage };
}

export function useUserInfo() {
	const { data: userInfo = null, isLoading: loading, refetch } = useQuery({
		queryKey: ["auth", "me"],
		queryFn: () => fetchJson<UserInfo>("/api/auth/me"),
	});

	return { userInfo, loading, refetch };
}

export function useWorkflowCounts() {
	const { data: counts = null } = useQuery({
		queryKey: ["workflows", "counts"],
		queryFn: () => fetchJson<WorkflowCounts>("/api/workflows/counts"),
		refetchInterval: 30_000,
	});

	return { counts };
}

export function useWorkflowRuns(statusFilter?: string) {
	const { data: runs = [], isLoading: loading, refetch } = useQuery({
		queryKey: ["workflows", "runs", statusFilter],
		queryFn: () => {
			const params = new URLSearchParams();
			if (statusFilter) params.set("status", statusFilter);
			return fetchJson<{ data: WorkflowRun[] }>(`/api/workflows?${params}`).then(
				(res) => res.data,
			);
		},
	});

	return { runs, loading, refetch };
}

export function useViolations(repo?: string) {
	const queryClient = useQueryClient();

	const { data, isLoading: loading, refetch } = useQuery({
		queryKey: ["violations", repo],
		queryFn: () => {
			const params = repo ? `?repo=${encodeURIComponent(repo)}` : "";
			return fetchJson<{ violations: Violation[] }>(`/api/violations${params}`);
		},
	});

	const resetViolations = useMutation({
		mutationFn: (repoToReset: string) =>
			fetchJson<{ reset: boolean }>("/api/violations/reset", {
				method: "POST",
				body: JSON.stringify({ repo: repoToReset }),
			}),
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: ["violations"] });
			queryClient.invalidateQueries({ queryKey: ["runners"] });
		},
	});

	return { violations: data?.violations ?? [], loading, refetch, resetViolations };
}

export function useRunnerTimeout() {
	const queryClient = useQueryClient();

	const setTimeout = useMutation({
		mutationFn: ({ runnerId, jobTimeoutMs }: { runnerId: string; jobTimeoutMs: number | null }) =>
			fetchJson<{ ok: boolean }>(`/api/runners/${runnerId}/timeout`, {
				method: "PUT",
				body: JSON.stringify({ jobTimeoutMs }),
			}),
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: ["runners"] });
		},
	});

	return { setTimeout };
}

export function useWorkflowDetail(workflowRunId: string | null) {
	const { data, isLoading: loading } = useQuery({
		queryKey: ["workflows", "detail", workflowRunId],
		queryFn: () =>
			Promise.all([
				fetchJson<WorkflowRun>(`/api/workflows/${workflowRunId}`),
				fetchJson<{ data: StepAttempt[] }>(`/api/workflows/${workflowRunId}/steps`),
			]).then(([run, s]) => ({ run, steps: s.data })),
		enabled: !!workflowRunId,
	});

	return { run: data?.run ?? null, steps: data?.steps ?? [], loading };
}
