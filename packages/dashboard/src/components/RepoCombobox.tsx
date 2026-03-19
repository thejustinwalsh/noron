import { useEffect, useRef, useState } from "react";
import { WaIcon, WaSpinner } from "@awesome.me/webawesome/dist/react";
import { useGithubRepos } from "../hooks/useApi";

interface RepoComboboxProps {
	value: string;
	onChange: (value: string) => void;
	/** Called when user picks a suggestion (passes the full_name) */
	onSelect?: (fullName: string) => void;
	/** Whether the user has repo scope — if false, skip fetch and show manual placeholder */
	hasRepoScope?: boolean;
}

export function RepoCombobox({ value, onChange, onSelect, hasRepoScope }: RepoComboboxProps) {
	const { repos, loading, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useGithubRepos(hasRepoScope);
	const isRefreshing = isFetchingNextPage || loading;
	const [open, setOpen] = useState(false);
	const [focusIndex, setFocusIndex] = useState(-1);
	const wrapperRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const dropdownRef = useRef<HTMLDivElement>(null);

	const filtered = value.length > 0
		? repos.filter((r) => r.fullName.toLowerCase().includes(value.toLowerCase()))
		: repos;

	const showDropdown = open && hasRepoScope !== false && (loading || filtered.length > 0);

	// Close on outside click
	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, []);

	// Fetch remaining pages eagerly once the first page lands
	useEffect(() => {
		if (hasNextPage && !isFetchingNextPage) {
			fetchNextPage();
		}
	}, [hasNextPage, isFetchingNextPage, fetchNextPage]);

	const handleFocus = () => {
		setOpen(true);
	};

	const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
		onChange(e.target.value);
		setOpen(true);
		setFocusIndex(-1);
	};

	const handleSelect = (fullName: string) => {
		onChange(fullName);
		onSelect?.(fullName);
		setOpen(false);
		inputRef.current?.blur();
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (!showDropdown) return;

		if (e.key === "ArrowDown") {
			e.preventDefault();
			setFocusIndex((i) => Math.min(i + 1, filtered.length - 1));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setFocusIndex((i) => Math.max(i - 1, 0));
		} else if (e.key === "Enter" && focusIndex >= 0 && focusIndex < filtered.length) {
			e.preventDefault();
			handleSelect(filtered[focusIndex].fullName);
		} else if (e.key === "Escape") {
			setOpen(false);
		}
	};

	return (
		<div className="repo-combobox" ref={wrapperRef}>
			<label className="repo-combobox-label">Repository</label>
			<div className="repo-combobox-input-wrap">
				<input
					ref={inputRef}
					type="text"
					className="repo-combobox-input"
					placeholder={hasRepoScope === false ? "type owner/repo" : "owner/repo"}
					value={value}
					onChange={handleInput}
					onFocus={handleFocus}
					onKeyDown={handleKeyDown}
					autoComplete="off"
				/>
				{(loading || isFetchingNextPage) && <WaSpinner style={{ fontSize: "14px", position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)" }} />}
			</div>
			{showDropdown && (
				<div className="repo-dropdown" ref={dropdownRef}>
					{loading && filtered.length === 0 && (
						<div className="repo-option repo-option-loading">Loading repos...</div>
					)}
					{filtered.slice(0, 20).map((repo, i) => (
						<div
							key={repo.fullName}
							className={`repo-option${i === focusIndex ? " repo-option-focused" : ""}`}
							onMouseDown={(e) => { e.preventDefault(); handleSelect(repo.fullName); }}
							onMouseEnter={() => setFocusIndex(i)}
						>
							<WaIcon
								name={repo.private ? "lock" : "globe"}
								family="classic"
								variant="solid"
								style={{ fontSize: "12px", color: "var(--text-muted)", flexShrink: 0 }}
							/>
							<div className="repo-option-text">
								<span className="repo-option-name">{repo.fullName}</span>
								{repo.description && (
									<span className="repo-option-desc">{repo.description}</span>
								)}
							</div>
						</div>
					))}
					{!loading && filtered.length === 0 && value.length > 0 && (
						<div className="repo-option repo-option-empty">
							No matching repos — type any owner/repo to use it
							<button
								type="button"
								className="repo-refresh-link"
								disabled={isRefreshing}
								onMouseDown={(e) => {
									e.preventDefault();
									e.stopPropagation();
									refetch();
								}}
							>
								{isRefreshing ? "Refreshing..." : "Refresh repo list"}
							</button>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
