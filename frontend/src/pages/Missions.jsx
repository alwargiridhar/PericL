import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    ArrowLeft, Plus, Target, Trash2, Loader2, X, CheckCircle2, AlertTriangle, TrendingUp, Calendar, Sparkles
} from "lucide-react";
import { Toaster, toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { missions as missionsStore } from "@/lib/storage";
import Footer from "@/components/Footer";

const PACE_META = {
    ahead: { label: "Ahead", className: "bg-primary/15 text-primary border-primary/30", Icon: TrendingUp },
    on_track: { label: "On track", className: "bg-primary/10 text-primary border-primary/20", Icon: CheckCircle2 },
    behind: { label: "Behind", className: "bg-destructive/15 text-destructive border-destructive/30", Icon: AlertTriangle },
    unknown: { label: "Set targets", className: "bg-muted text-muted-foreground border-border", Icon: Target },
};

function fmtDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function MissionsPage() {
    const navigate = useNavigate();
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [logFor, setLogFor] = useState(null); // mission for logging progress

    const load = async () => {
        try {
            setItems(await missionsStore.list());
        } catch {
            toast.error("Could not load missions");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const onCreated = (m) => {
        setItems((p) => [m, ...p]);
        setDialogOpen(false);
        toast.success("Mission created");
    };

    const remove = async (m) => {
        try {
            await missionsStore.delete(m.id);
            setItems((p) => p.filter((x) => x.id !== m.id));
            toast.success("Mission removed");
        } catch {
            toast.error("Could not remove");
        }
    };

    const activeCount = items.filter((m) => m.is_active !== false).length;

    if (loading) {
        return (
            <div className="min-h-screen grid place-items-center bg-background">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="min-h-screen flex flex-col bg-background text-foreground" data-testid="missions-page">
            <Toaster position="top-center" richColors />
            <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/80 border-b border-border/60">
                <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
                    <Button
                        data-testid="missions-back"
                        variant="ghost"
                        size="icon"
                        onClick={() => navigate("/")}
                        className="rounded-full"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <span className="font-display text-base font-medium">Missions</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                        {activeCount}/3 active
                    </span>
                </div>
            </header>

            <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-8 space-y-6">
                <div>
                    <h1 className="font-display text-3xl tracking-tight">Where are you going?</h1>
                    <p className="text-muted-foreground mt-1.5 leading-relaxed max-w-xl">
                        Up to three quarterly missions. Each can have tracks (books, modules, areas) with measurable units.
                        Progress is logged from your journal entries automatically — no guessing.
                    </p>
                </div>

                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                        <Button
                            data-testid="missions-new-btn"
                            className="rounded-full h-11"
                            disabled={activeCount >= 3}
                        >
                            <Plus className="w-4 h-4 mr-2" />
                            New mission
                        </Button>
                    </DialogTrigger>
                    <CreateMissionDialog onCreated={onCreated} />
                </Dialog>

                {items.length === 0 ? (
                    <div className="text-center py-12 rounded-3xl bg-muted/40 border-2 border-dashed border-border">
                        <div className="relative w-24 h-24 mx-auto mb-4">
                            <div className="absolute inset-0 bg-primary/15 blob" />
                            <div className="absolute inset-0 grid place-items-center">
                                <Target className="w-8 h-8 text-primary" />
                            </div>
                        </div>
                        <p className="font-display text-xl">No missions yet.</p>
                        <p className="text-sm text-muted-foreground mt-2">
                            Pick the 1-3 things you want to actually move on this quarter.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {items.map((m) => (
                            <MissionCard
                                key={m.id}
                                m={m}
                                onLog={() => setLogFor(m)}
                                onDelete={() => remove(m)}
                            />
                        ))}
                    </div>
                )}

                {logFor && (
                    <LogProgressDialog
                        mission={logFor}
                        onClose={() => setLogFor(null)}
                        onLogged={async () => { setLogFor(null); await load(); toast.success("Progress logged"); }}
                    />
                )}
            </main>
            <Footer />
        </div>
    );
}

function MissionCard({ m, onLog, onDelete }) {
    const stats = m.stats || {};
    const meta = PACE_META[stats.pace] || PACE_META.unknown;
    const PaceIcon = meta.Icon;

    return (
        <div className="rounded-3xl border border-border bg-card p-5 space-y-3" data-testid={`mission-${m.id}`}>
            <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-2xl bg-muted grid place-items-center shrink-0">
                    <Target className="w-4 h-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                        <h3 className="font-display text-lg leading-snug">{m.title}</h3>
                        <span
                            className={`text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full border inline-flex items-center gap-1 shrink-0 ${meta.className}`}
                        >
                            <PaceIcon className="w-2.5 h-2.5" />
                            {meta.label}
                        </span>
                    </div>
                    {m.outcome && <p className="text-sm text-muted-foreground mt-0.5">{m.outcome}</p>}
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                        {m.target_date && (
                            <span className="inline-flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                by {fmtDate(m.target_date)}
                            </span>
                        )}
                        {stats.days_remaining !== null && stats.days_remaining !== undefined && (
                            <span>· {stats.days_remaining}d remaining</span>
                        )}
                        {stats.consistency_pct !== undefined && (
                            <span>· {Math.round(stats.consistency_pct)}% consistency</span>
                        )}
                    </div>
                </div>
            </div>

            {/* Tracks */}
            {(stats.tracks || []).length > 0 && (
                <div className="space-y-2">
                    {stats.tracks.map((tr) => (
                        <TrackBar key={tr.id} tr={tr} />
                    ))}
                </div>
            )}

            {/* Aggregate */}
            {stats.target_units > 0 && (
                <div className="text-xs text-muted-foreground">
                    {Math.round(stats.logged_units)} / {Math.round(stats.target_units)} units logged · {Math.round(stats.percent_complete)}%
                </div>
            )}

            <div className="flex items-center gap-2 pt-1">
                <Button
                    data-testid={`mission-log-${m.id}`}
                    onClick={onLog}
                    size="sm"
                    variant="outline"
                    className="rounded-full text-xs h-8"
                >
                    <Sparkles className="w-3 h-3 mr-1.5" />
                    Log progress
                </Button>
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button
                            data-testid={`mission-delete-${m.id}`}
                            size="icon"
                            variant="ghost"
                            className="ml-auto rounded-full h-8 w-8 text-muted-foreground hover:text-destructive"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Remove this mission?</AlertDialogTitle>
                            <AlertDialogDescription>
                                Deletes the mission and all its progress entries.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={onDelete}
                                className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                            >
                                Remove
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </div>
    );
}

function TrackBar({ tr }) {
    const pct = Math.max(0, Math.min(100, tr.percent || 0));
    return (
        <div data-testid={`track-${tr.id}`}>
            <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium truncate pr-2">{tr.title}</span>
                <span className="text-muted-foreground tabular-nums shrink-0">
                    {Math.round(tr.logged_units)} / {Math.round(tr.target_units)} {tr.unit_label}
                </span>
            </div>
            <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                <div
                    className="h-full bg-primary transition-[width] duration-500"
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
}

function CreateMissionDialog({ onCreated }) {
    const [busy, setBusy] = useState(false);
    const [title, setTitle] = useState("");
    const [outcome, setOutcome] = useState("");
    const [targetDate, setTargetDate] = useState("");
    const [tracks, setTracks] = useState([{ title: "", target_units: "", unit_label: "pages" }]);

    const updateTrack = (i, k, v) => {
        const next = [...tracks];
        next[i] = { ...next[i], [k]: v };
        setTracks(next);
    };
    const addTrack = () => tracks.length < 6 && setTracks([...tracks, { title: "", target_units: "", unit_label: "pages" }]);
    const removeTrack = (i) => setTracks(tracks.filter((_, idx) => idx !== i));

    const submit = async () => {
        if (!title.trim()) return;
        setBusy(true);
        try {
            const cleanTracks = tracks
                .filter((t) => t.title.trim())
                .map((t) => ({
                    title: t.title.trim(),
                    target_units: Number(t.target_units) || 0,
                    unit_label: t.unit_label || "units",
                }));
            const m = await missionsStore.create({
                title: title.trim(),
                outcome: outcome.trim(),
                target_date: targetDate ? new Date(targetDate).toISOString() : null,
                tracks: cleanTracks,
            });
            onCreated(m);
        } catch (e) {
            toast.error(e.userMessage || e.message || "Could not create");
        } finally {
            setBusy(false);
        }
    };

    return (
        <DialogContent className="max-w-lg">
            <DialogHeader>
                <DialogTitle>New mission</DialogTitle>
                <DialogDescription>Pick something measurable. Add tracks if it has sub-areas.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
                <div>
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1.5 block">Title</label>
                    <Input
                        data-testid="mission-form-title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Read more books"
                    />
                </div>
                <div>
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1.5 block">Outcome</label>
                    <Textarea
                        data-testid="mission-form-outcome"
                        rows={2}
                        value={outcome}
                        onChange={(e) => setOutcome(e.target.value)}
                        placeholder="Read 12 books across 3 areas by end of quarter"
                    />
                </div>
                <div>
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1.5 block">Target date</label>
                    <Input
                        data-testid="mission-form-target-date"
                        type="date"
                        value={targetDate}
                        onChange={(e) => setTargetDate(e.target.value)}
                    />
                </div>
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Tracks (sub-goals)</label>
                        <button
                            data-testid="mission-form-add-track"
                            type="button"
                            onClick={addTrack}
                            className="text-xs text-primary hover:underline"
                        >
                            + Add track
                        </button>
                    </div>
                    <div className="space-y-2">
                        {tracks.map((t, i) => (
                            <div key={i} className="flex gap-2 items-start">
                                <Input
                                    data-testid={`mission-form-track-title-${i}`}
                                    value={t.title}
                                    onChange={(e) => updateTrack(i, "title", e.target.value)}
                                    placeholder="Atomic Habits"
                                    className="flex-1"
                                />
                                <Input
                                    data-testid={`mission-form-track-units-${i}`}
                                    type="number"
                                    value={t.target_units}
                                    onChange={(e) => updateTrack(i, "target_units", e.target.value)}
                                    placeholder="320"
                                    className="w-24"
                                />
                                <Select
                                    value={t.unit_label}
                                    onValueChange={(v) => updateTrack(i, "unit_label", v)}
                                >
                                    <SelectTrigger
                                        data-testid={`mission-form-track-unit-${i}`}
                                        className="w-32"
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {["pages", "problems", "sessions", "hours", "minutes", "modules", "chapters", "items", "reps"].map((u) => (
                                            <SelectItem key={u} value={u}>{u}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {tracks.length > 1 && (
                                    <Button
                                        type="button"
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => removeTrack(i)}
                                        className="rounded-full h-9 w-9 shrink-0"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <DialogFooter>
                <Button
                    data-testid="mission-form-submit"
                    onClick={submit}
                    disabled={busy || !title.trim()}
                    className="rounded-full"
                >
                    {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                    Create mission
                </Button>
            </DialogFooter>
        </DialogContent>
    );
}

function LogProgressDialog({ mission, onClose, onLogged }) {
    const [busy, setBusy] = useState(false);
    const [trackId, setTrackId] = useState(mission.tracks?.[0]?.id || "none");
    const [units, setUnits] = useState("");
    const [effort, setEffort] = useState("medium");
    const [note, setNote] = useState("");

    const submit = async () => {
        const u = Number(units);
        if (!u || u <= 0) return;
        setBusy(true);
        try {
            await missionsStore.logProgress(mission.id, {
                track_id: trackId === "none" ? null : trackId,
                units: u,
                effort,
                note,
            });
            onLogged();
        } catch (e) {
            toast.error(e.message || "Could not log");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={!!mission} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Log progress · {mission.title}</DialogTitle>
                    <DialogDescription>Real numbers only. Even a small bit counts.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    {mission.tracks?.length > 0 && (
                        <div>
                            <label className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1.5 block">Track</label>
                            <Select value={trackId} onValueChange={setTrackId}>
                                <SelectTrigger data-testid="log-progress-track"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">— none / generic —</SelectItem>
                                    {mission.tracks.map((t) => (
                                        <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    <div>
                        <label className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1.5 block">
                            Units progressed
                        </label>
                        <Input
                            data-testid="log-progress-units"
                            type="number"
                            value={units}
                            onChange={(e) => setUnits(e.target.value)}
                            placeholder="12"
                        />
                    </div>
                    <div>
                        <label className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1.5 block">Effort</label>
                        <Select value={effort} onValueChange={setEffort}>
                            <SelectTrigger data-testid="log-progress-effort"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="low">Low — under 15 min</SelectItem>
                                <SelectItem value="medium">Medium — 15-45 min</SelectItem>
                                <SelectItem value="deep">Deep — 45+ min focused</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <label className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1.5 block">Note (optional)</label>
                        <Textarea
                            data-testid="log-progress-note"
                            rows={2}
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="Chapter on habit stacking"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button data-testid="log-progress-submit" onClick={submit} disabled={busy} className="rounded-full">
                        {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                        Log progress
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
