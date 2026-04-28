import { useMemo } from "react";
import { Check, Bell, Lightbulb, Mic, Trash2, ListTodo, FileText } from "lucide-react";
import { audioUrl } from "@/lib/api";

const TYPE_META = {
    voice: { Icon: Mic, label: "Voice", tone: "primary" },
    text: { Icon: FileText, label: "Note", tone: "primary" },
    task: { Icon: ListTodo, label: "Task", tone: "accent" },
    reminder: { Icon: Bell, label: "Reminder", tone: "accent" },
    idea: { Icon: Lightbulb, label: "Idea", tone: "muted" },
};

function fmtRelative(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtDue(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

export default function TimelineItem({ item, onToggle, onDelete }) {
    const meta = TYPE_META[item.type] || TYPE_META.text;
    const isMine = item.type === "voice" || item.type === "text";
    const isExtracted = item.type === "task" || item.type === "reminder" || item.type === "idea";
    const due = useMemo(() => fmtDue(item.due_at), [item.due_at]);

    if (isMine) {
        return (
            <div className="flex justify-end animate-float-in" data-testid={`timeline-item-${item.type}`}>
                <div className="max-w-[85%]">
                    <div className="bubble-mine px-4 py-3 shadow-md shadow-primary/15">
                        {item.type === "voice" && item.audio_id && (
                            <audio
                                data-testid={`audio-${item.id}`}
                                controls
                                src={audioUrl(item.audio_id)}
                                className="w-full mb-2 max-w-xs"
                                style={{ filter: "invert(0)" }}
                            />
                        )}
                        {(item.transcription || item.detail) && (
                            <p className="text-[15px] leading-relaxed whitespace-pre-wrap">
                                {item.transcription || item.detail}
                            </p>
                        )}
                        {item.summary && (item.transcription || item.detail) && item.summary !== (item.transcription || item.detail) && (
                            <p className="text-xs mt-2 opacity-80 italic">— {item.summary}</p>
                        )}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1 px-1 text-right">
                        {fmtRelative(item.created_at)}
                    </div>
                </div>
            </div>
        );
    }

    if (isExtracted) {
        const Icon = meta.Icon;
        return (
            <div className="flex justify-start animate-float-in" data-testid={`timeline-item-${item.type}`}>
                <div className="max-w-[85%]">
                    <div className="bubble-them px-4 py-3 flex items-start gap-3">
                        <div className="mt-0.5 w-8 h-8 rounded-2xl bg-muted grid place-items-center shrink-0">
                            <Icon className="w-4 h-4 text-accent" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-0.5">
                                {meta.label}
                                {item.priority && (
                                    <span className="ml-2 inline-block px-1.5 py-px rounded-full bg-muted text-[9px]">
                                        {item.priority}
                                    </span>
                                )}
                            </div>
                            <p
                                className={`text-[15px] leading-snug ${
                                    item.completed ? "line-through opacity-60" : ""
                                }`}
                            >
                                {item.title}
                            </p>
                            {due && !item.completed && (
                                <p className="text-xs text-accent mt-1 font-medium">⏰ {due}</p>
                            )}
                            <div className="flex items-center gap-2 mt-2">
                                {item.type !== "idea" && (
                                    <button
                                        data-testid={`item-toggle-${item.id}`}
                                        onClick={() => onToggle(item)}
                                        className="text-xs font-medium px-2.5 py-1 rounded-full bg-muted hover:bg-primary hover:text-primary-foreground transition-colors flex items-center gap-1"
                                    >
                                        <Check className="w-3 h-3" />
                                        {item.completed ? "Mark open" : "Done"}
                                    </button>
                                )}
                                <button
                                    data-testid={`item-delete-${item.id}`}
                                    onClick={() => onDelete(item)}
                                    className="text-xs font-medium px-2 py-1 rounded-full text-muted-foreground hover:text-destructive transition-colors"
                                    aria-label="Delete"
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1 px-1">
                        {fmtRelative(item.created_at)}
                    </div>
                </div>
            </div>
        );
    }

    return null;
}
