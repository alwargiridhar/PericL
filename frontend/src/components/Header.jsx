import { Sun, Moon, BarChart3, LogOut, User, MessageCircle, Calendar, Brain, Lock, Shield, KeyRound, Target, Search, Home as HomeIcon, BookOpen, CreditCard } from "lucide-react";
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
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { useStorage } from "@/contexts/StorageContext";

export default function Header({ onOpenRecaps }) {
    const { theme, toggle } = useTheme();
    const { user, logout } = useAuth();
    const { mode } = useStorage();
    const navigate = useNavigate();

    return (
        <header
            className="sticky top-0 z-30 backdrop-blur-xl bg-background/80 border-b border-border/60"
            data-testid="app-header"
        >
            <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
                <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-2xl bg-primary text-primary-foreground grid place-items-center font-display font-medium">
                        P
                    </div>
                    <div className="leading-tight">
                        <div className="font-display text-base font-medium">PericL</div>
                        <div className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                            <span>A Private Behavioral OS</span>
                            {mode !== "cloud" && (
                                <span className="inline-flex items-center gap-1 text-primary" title="Stored on this device only">
                                    <Lock className="w-2.5 h-2.5" />
                                    on-device
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="ml-auto flex items-center gap-1">
                    <Button
                        data-testid="header-home-btn"
                        variant="ghost"
                        size="icon"
                        onClick={() => navigate("/")}
                        className="rounded-full h-9 w-9"
                        aria-label="Home"
                    >
                        <HomeIcon className="w-4 h-4" />
                    </Button>
                    <Button
                        data-testid="header-journal-btn"
                        variant="ghost"
                        size="icon"
                        onClick={() => navigate("/journal")}
                        className="rounded-full h-9 w-9"
                        aria-label="Journal"
                    >
                        <BookOpen className="w-4 h-4" />
                    </Button>
                    <Button
                        data-testid="header-search-btn"
                        variant="ghost"
                        size="icon"
                        onClick={() => navigate("/search")}
                        className="rounded-full h-9 w-9"
                        aria-label="Search"
                    >
                        <Search className="w-4 h-4" />
                    </Button>
                    <Button
                        data-testid="header-missions-btn"
                        variant="ghost"
                        size="icon"
                        onClick={() => navigate("/missions")}
                        className="rounded-full h-9 w-9"
                        aria-label="Missions"
                    >
                        <Target className="w-4 h-4" />
                    </Button>
                    <Button
                        data-testid="header-chat-btn"
                        variant="ghost"
                        size="icon"
                        onClick={() => navigate("/chat")}
                        className="rounded-full h-9 w-9"
                        aria-label="Talk to yourself"
                    >
                        <MessageCircle className="w-4 h-4" />
                    </Button>
                    <Button
                        data-testid="header-prompt-btn"
                        variant="ghost"
                        size="icon"
                        onClick={() => navigate("/daily-prompt")}
                        className="rounded-full h-9 w-9"
                        aria-label="Daily reflection"
                    >
                        <Calendar className="w-4 h-4" />
                    </Button>
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

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                data-testid="header-user-menu-trigger"
                                className="ml-1 w-9 h-9 rounded-full overflow-hidden ring-1 ring-border bg-muted grid place-items-center"
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
            </div>
        </header>
    );
}
