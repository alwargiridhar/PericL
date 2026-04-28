import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Search, Shield, Crown, UserCog, Trash2, Loader2, Cloud, Lock } from "lucide-react";
import { Toaster, toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import Footer from "@/components/Footer";

function fmt(d) {
    if (!d) return "—";
    return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const ROLE_META = {
    super_admin: { label: "Super admin", className: "bg-accent/15 text-accent border-accent/30", Icon: Crown },
    admin: { label: "Admin", className: "bg-primary/15 text-primary border-primary/30", Icon: Shield },
    user: { label: "User", className: "bg-muted text-muted-foreground border-border", Icon: UserCog },
};

export default function Admin() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [users, setUsers] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState(null);
    const [q, setQ] = useState("");

    const isSuper = user?.role === "super_admin";

    const load = async () => {
        try {
            const [u, s] = await Promise.all([api.get("/admin/users"), api.get("/admin/stats")]);
            setUsers(u.data || []);
            setStats(s.data || null);
        } catch {
            toast.error("Could not load users — check your permissions");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!user) return;
        if (user.role !== "admin" && user.role !== "super_admin") {
            navigate("/", { replace: true });
            return;
        }
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user]);

    const setRole = async (target, role) => {
        setBusyId(target.user_id);
        try {
            await api.put(`/admin/users/${target.user_id}/role`, { role });
            toast.success(`${target.name} is now ${role.replace("_", " ")}`);
            await load();
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Could not change role");
        } finally {
            setBusyId(null);
        }
    };

    const removeUser = async (target) => {
        setBusyId(target.user_id);
        try {
            await api.delete(`/admin/users/${target.user_id}`);
            toast.success(`Removed ${target.name}`);
            await load();
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Could not remove user");
        } finally {
            setBusyId(null);
        }
    };

    const filtered = useMemo(() => {
        if (!q.trim()) return users;
        const k = q.toLowerCase();
        return users.filter(
            (u) => (u.email || "").toLowerCase().includes(k) || (u.name || "").toLowerCase().includes(k)
        );
    }, [users, q]);

    if (loading) {
        return (
            <div className="min-h-screen grid place-items-center bg-background">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="min-h-screen flex flex-col bg-background text-foreground" data-testid="admin-page">
            <Toaster position="top-center" richColors />
            <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/80 border-b border-border/60">
                <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-2">
                    <Button
                        data-testid="admin-back"
                        variant="ghost"
                        size="icon"
                        onClick={() => navigate("/")}
                        className="rounded-full"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <span className="font-display text-base font-medium">Admin</span>
                    <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                        {isSuper ? <Crown className="w-3.5 h-3.5 text-accent" /> : <Shield className="w-3.5 h-3.5 text-primary" />}
                        <span>{isSuper ? "Super admin" : "Admin"}</span>
                    </div>
                </div>
            </header>

            <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-8 space-y-6">
                {/* Stats */}
                {stats && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Stat label="Users" value={stats.total_users} />
                        <Stat label="Admins" value={stats.admins} />
                        <Stat label="On cloud" value={stats.cloud_users} icon={Cloud} />
                        <Stat label="Active 7d" value={stats.active_7d} />
                    </div>
                )}

                {/* Search */}
                <div className="relative">
                    <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        data-testid="admin-search"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Search by name or email"
                        className="pl-11 h-12 rounded-full"
                    />
                </div>

                {/* Users */}
                <div className="space-y-2" data-testid="admin-users-list">
                    {filtered.length === 0 ? (
                        <p className="text-center text-muted-foreground py-12">No users match.</p>
                    ) : (
                        filtered.map((u) => (
                            <UserRow
                                key={u.user_id}
                                u={u}
                                isSuper={isSuper}
                                meIsTarget={u.user_id === user?.user_id}
                                busy={busyId === u.user_id}
                                onSetRole={setRole}
                                onRemove={removeUser}
                            />
                        ))
                    )}
                </div>

                <div className="rounded-2xl bg-muted/40 p-4 text-xs text-muted-foreground leading-relaxed">
                    <strong className="text-foreground">Privacy note.</strong>{" "}
                    Most users keep their data on-device by default. The dashboard shows identity, role and storage mode only —
                    not their journal entries or chats.
                </div>
            </main>
            <Footer />
        </div>
    );
}

function Stat({ label, value, icon: Icon }) {
    return (
        <div className="rounded-2xl bg-card border border-border p-4">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                {Icon && <Icon className="w-3 h-3" />}
                {label}
            </div>
            <div className="font-display text-3xl mt-1">{value}</div>
        </div>
    );
}

function UserRow({ u, isSuper, meIsTarget, busy, onSetRole, onRemove }) {
    const meta = ROLE_META[u.role] || ROLE_META.user;
    const RoleIcon = meta.Icon;
    const canEditRole = isSuper && !meIsTarget;
    const isLocked = u.role === "super_admin"; // super admin row is read-only on role

    return (
        <div
            className="rounded-2xl border border-border bg-card p-3 sm:p-4 flex items-center gap-3"
            data-testid={`admin-user-${u.user_id}`}
        >
            <div className="w-10 h-10 rounded-full overflow-hidden bg-muted shrink-0 grid place-items-center">
                {u.picture ? (
                    <img src={u.picture} alt={u.name} className="w-full h-full object-cover" />
                ) : (
                    <UserCog className="w-4 h-4" />
                )}
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{u.name}</span>
                    <span
                        className={`text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${meta.className}`}
                    >
                        <RoleIcon className="w-2.5 h-2.5" />
                        {meta.label}
                    </span>
                    <span
                        className={`text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
                            u.storage_mode === "cloud" ? "bg-accent/10 text-accent" : "bg-muted text-muted-foreground"
                        }`}
                    >
                        {u.storage_mode === "cloud" ? <Cloud className="w-2.5 h-2.5" /> : <Lock className="w-2.5 h-2.5" />}
                        {u.storage_mode === "cloud" ? "cloud" : "on-device"}
                    </span>
                </div>
                <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                    Joined {fmt(u.created_at)} · Last seen {fmt(u.last_seen_at)}
                </div>
            </div>

            {canEditRole && !isLocked && (
                <div className="flex items-center gap-1.5 shrink-0">
                    {u.role === "user" ? (
                        <Button
                            data-testid={`admin-promote-${u.user_id}`}
                            disabled={busy}
                            size="sm"
                            variant="outline"
                            onClick={() => onSetRole(u, "admin")}
                            className="rounded-full text-xs h-8"
                        >
                            <Shield className="w-3 h-3 mr-1.5" />
                            Make admin
                        </Button>
                    ) : (
                        <Button
                            data-testid={`admin-demote-${u.user_id}`}
                            disabled={busy}
                            size="sm"
                            variant="outline"
                            onClick={() => onSetRole(u, "user")}
                            className="rounded-full text-xs h-8"
                        >
                            Demote
                        </Button>
                    )}
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button
                                data-testid={`admin-delete-${u.user_id}`}
                                disabled={busy}
                                size="icon"
                                variant="ghost"
                                className="rounded-full h-8 w-8 text-muted-foreground hover:text-destructive"
                                aria-label="Remove user"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Remove {u.name}?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This permanently deletes their account and all cloud data we hold.
                                    Any data on their device stays untouched.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                    data-testid={`admin-delete-confirm-${u.user_id}`}
                                    onClick={() => onRemove(u)}
                                    className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                                >
                                    Remove
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            )}
        </div>
    );
}
