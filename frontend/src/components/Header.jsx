import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Sun, Moon, BarChart3, LogOut, User, MessageCircle, Calendar, Brain, Lock,
    Shield, KeyRound, Target, Search, Home as HomeIcon, BookOpen, CreditCard, Menu,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { useStorage } from "@/contexts/StorageContext";
import Logo from "@/components/Logo";

const NAV_ITEMS = [
    { Icon: HomeIcon, label: "Home", to: "/", testid: "header-home" },
    { Icon: BookOpen, label: "Journal", to: "/journal", testid: "header-journal" },
    { Icon: MessageCircle, label: "Mirror", to: "/chat", testid: "header-chat" },
    { Icon: Target, label: "Missions", to: "/missions", testid: "header-missions" },
    { Icon: Search, label: "Search", to: "/search", testid: "header-search" },
    { Icon: Calendar, label: "Daily prompt", to: "/daily-prompt", testid: "header-prompt" },
];

export default function Header({ onOpenRecaps }) {
    const { theme, toggle } = useTheme();
    const { user, logout } = useAuth();
    const { mode } = useStorage();
    const navigate = useNavigate();
    const [drawerOpen, setDrawerOpen] = useState(false);

    const go = (to) => { setDrawerOpen(false); navigate(to); };

    return (
        <header
            className="sticky top-0 z-30 backdrop-blur-xl bg-background/80 border-b border-border/60"
            data-testid="app-header"
        >
            <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
                {/* Brand — compact on mobile */}
                <button
                    onClick={() => navigate("/")}
                    className="flex items-center gap-2.5 min-w-0 group"
                    data-testid="header-brand"
                    aria-label="Home"
                >
                    <Logo size={32} className="sm:w-9 sm:h-9 shrink-0" />
                    <div className="leading-tight text-left min-w-0">
                        <div className="font-display text-sm sm:text-base font-medium">PericL</div>
                        <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.18em] text-muted-foreground truncate hidden sm:flex sm:items-center sm:gap-1.5">
                            <span>A Private Behavioral OS</span>
                            {mode !== "cloud" && (
                                <span className="hidden md:inline-flex items-center gap-1 text-primary" title="Stored on this device only">
                                    <Lock className="w-2.5 h-2.5" />
                                    on-device
                                </span>
                            )}
                        </div>
                    </div>
                </button>

                {/* Desktop nav — icon row */}
                <nav className="ml-auto hidden md:flex items-center gap-1">
                    {NAV_ITEMS.map((it) => (
                        <Button
                            key={it.testid}
                            data-testid={`${it.testid}-btn`}
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate(it.to)}
                            className="rounded-full h-9 w-9"
                            aria-label={it.label}
                        >
                            <it.Icon className="w-4 h-4" />
                        </Button>
                    ))}
                    {onOpenRecaps && (
                        <Button
                            data-testid="header-recap-btn"
                            variant="ghost"
                            size="icon"
                            onClick={onOpenRecaps}
                            className="rounded-full h-9 w-9"
                            aria-label="Daily recap"
                        >
                            <BarChart3 className="w-4 h-4" />
                        </Button>
                    )}
                    <Button
                        data-testid="header-theme-toggle"
                        variant="ghost"
                        size="icon"
                        onClick={toggle}
                        className="rounded-full h-9 w-9"
                        aria-label="Toggle theme"
                    >
                        {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    </Button>
                </nav>

                {/* Mobile nav — hamburger drawer + theme + avatar */}
                <div className="ml-auto md:hidden flex items-center gap-1">
                    <Button
                        data-testid="header-theme-toggle-mobile"
                        variant="ghost"
                        size="icon"
                        onClick={toggle}
                        className="rounded-full h-9 w-9"
                        aria-label="Toggle theme"
                    >
                        {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    </Button>
                    <Button
                        data-testid="header-mobile-menu-trigger"
                        variant="ghost"
                        size="icon"
                        onClick={() => setDrawerOpen(true)}
                        className="rounded-full h-9 w-9"
                        aria-label="Open menu"
                    >
                        <Menu className="w-4 h-4" />
                    </Button>
                </div>

                {/* Avatar / user menu — both viewports */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            data-testid="header-user-menu-trigger"
                            className="ml-1 w-9 h-9 rounded-full overflow-hidden ring-1 ring-border bg-muted grid place-items-center shrink-0"
                            aria-label="Account menu"
                        >
                            {user?.picture ? (
                                <img src={user.picture} alt={user.name} className="w-full h-full object-cover" />
                            ) : (
                                <User className="w-4 h-4" />
                            )}
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuLabel className="leading-tight">
                            <div className="font-medium truncate">{user?.name}</div>
                            <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            data-testid="menu-profile"
                            onClick={() => navigate("/profile")}
                        >
                            <User className="w-4 h-4 mr-2" />
                            My profile
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            data-testid="menu-personality"
                            onClick={() => navigate("/personality/assessment")}
                        >
                            <Brain className="w-4 h-4 mr-2" />
                            Personality test
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            data-testid="menu-account"
                            onClick={() => navigate("/account")}
                        >
                            <CreditCard className="w-4 h-4 mr-2" />
                            Account &amp; plan
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            data-testid="menu-privacy"
                            onClick={() => navigate("/privacy")}
                        >
                            <Lock className="w-4 h-4 mr-2" />
                            Privacy &amp; data
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            data-testid="menu-manage-password"
                            onClick={() => window.open("https://myaccount.google.com/security", "_blank", "noopener,noreferrer")}
                        >
                            <KeyRound className="w-4 h-4 mr-2" />
                            Manage password (Google)
                        </DropdownMenuItem>
                        {(user?.role === "admin" || user?.role === "super_admin") && (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    data-testid="menu-admin"
                                    onClick={() => navigate("/admin")}
                                >
                                    <Shield className="w-4 h-4 mr-2" />
                                    Admin {user.role === "super_admin" ? "(super)" : ""}
                                </DropdownMenuItem>
                            </>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            data-testid="header-logout"
                            onClick={logout}
                            className="text-destructive focus:text-destructive"
                        >
                            <LogOut className="w-4 h-4 mr-2" />
                            Sign out
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {/* Mobile slide-down drawer */}
            {drawerOpen && (
                <div
                    className="md:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm animate-in fade-in"
                    onClick={() => setDrawerOpen(false)}
                    data-testid="header-mobile-drawer"
                >
                    <div
                        className="absolute top-0 left-0 right-0 bg-background border-b border-border shadow-xl p-4 pt-3"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-3">
                            <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                                Navigate
                            </div>
                            <button
                                onClick={() => setDrawerOpen(false)}
                                className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
                                data-testid="header-mobile-drawer-close"
                            >
                                Close
                            </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {NAV_ITEMS.map((it) => (
                                <button
                                    key={it.testid}
                                    data-testid={`${it.testid}-mobile`}
                                    onClick={() => go(it.to)}
                                    className="flex flex-col items-center gap-1.5 rounded-2xl border border-border/60 bg-card/60 p-3 hover:border-primary/40 transition-colors"
                                >
                                    <it.Icon className="w-4 h-4 text-muted-foreground" />
                                    <span className="text-[11px]">{it.label}</span>
                                </button>
                            ))}
                            {onOpenRecaps && (
                                <button
                                    data-testid="header-recap-mobile"
                                    onClick={() => { setDrawerOpen(false); onOpenRecaps && onOpenRecaps(); }}
                                    className="flex flex-col items-center gap-1.5 rounded-2xl border border-border/60 bg-card/60 p-3 hover:border-primary/40 transition-colors"
                                >
                                    <BarChart3 className="w-4 h-4 text-muted-foreground" />
                                    <span className="text-[11px]">Recap</span>
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </header>
    );
}
