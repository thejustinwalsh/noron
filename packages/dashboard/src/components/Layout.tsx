import type { WaTabShowEvent } from "@awesome.me/webawesome/dist/events/tab-show.js";
import { WaBadge, WaButton, WaIcon, WaTab, WaTabGroup } from "@awesome.me/webawesome/dist/react";
import { type ReactNode, useMemo } from "react";
import type { LockHolder, WorkflowCounts } from "../types";
import { StatusBar } from "./StatusBar";

interface LayoutProps {
	connected: boolean;
	currentPage: string;
	onNavigate: (page: string) => void;
	authenticated: boolean;
	login: string | null;
	isAdmin: boolean;
	lock: LockHolder | null;
	queueDepth: number;
	workflowCounts: WorkflowCounts | null;
	onLogout: () => void;
	children: ReactNode;
}

export function Layout({
	connected,
	currentPage,
	onNavigate,
	authenticated,
	login,
	isAdmin,
	lock,
	queueDepth,
	workflowCounts,
	onLogout,
	children,
}: LayoutProps) {
	const navItems = useMemo(
		() => [
			{ id: "dashboard", label: "Dashboard" },
			{ id: "runners", label: "Runners" },
			...(isAdmin ? [{ id: "admin", label: "Admin" }] : []),
		],
		[isAdmin],
	);

	return (
		<div className="layout">
			<header className="header">
				<div className="header-left">
					<h1 className="header-title">Benchmark</h1>
					<WaBadge
						pill
						variant={connected ? "success" : "danger"}
						attention={connected ? "pulse" : "none"}
					>
						{connected ? "Live" : "Offline"}
					</WaBadge>
				</div>
				<nav>
					<WaTabGroup
						activation="manual"
						onWaTabShow={(e: WaTabShowEvent) => {
							onNavigate(e.detail.name);
						}}
					>
						{navItems.map((item) => (
							<WaTab key={item.id} slot="nav" panel={item.id} active={currentPage === item.id}>
								{item.label}
							</WaTab>
						))}
					</WaTabGroup>
				</nav>
				<div className="header-right">
					{authenticated ? (
						<div className="user-menu">
							<span className="user-login">
								<WaIcon
									name="github"
									family="brands"
									variant="solid"
									style={{ marginRight: "4px" }}
								/>
								{login}
							</span>
							<WaButton variant="neutral" appearance="outlined" size="small" onClick={onLogout}>
								Logout
							</WaButton>
						</div>
					) : (
						<WaButton
							variant="brand"
							size="small"
							onClick={() => {
								window.location.href = "/auth/login";
							}}
						>
							<WaIcon name="github" family="brands" variant="solid" slot="prefix" />
							Sign in
						</WaButton>
					)}
				</div>
			</header>
			<StatusBar
				lock={lock}
				queueDepth={queueDepth}
				workflowCounts={workflowCounts}
				onNavigateWorkflows={() => onNavigate("workflows")}
			/>
			<main className="main">{children}</main>
		</div>
	);
}
