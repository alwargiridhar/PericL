import { useEffect, useRef, useState } from "react";
import { Mic, Square, X, Check, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRecorder } from "@/hooks/useRecorder";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";

function fmtTime(s) {
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${m}:${String(ss).padStart(2, "0")}`;
}

export default function VoiceDock({ onSave, mode, setMode, onSendText, busy }) {
    const rec = useRecorder();
    const sr = useSpeechRecognition();

    const handleStart = async () => {
        sr.reset();
        if (sr.supported) sr.start();
        await rec.start();
    };
    const handleStop = () => {
        rec.stop();
        sr.stop();
    };
    const handleCancel = () => {
        rec.reset();
        sr.stop();
        sr.reset();
    };
    const handleSave = async () => {
        if (!rec.audioBlob) return;
        await onSave({ blob: rec.audioBlob, duration: rec.seconds, transcript: sr.transcript });
        rec.reset();
        sr.reset();
    };

    const recordingActive = rec.isRecording || rec.isPaused || rec.audioBlob;

    return (
        <div className="sticky bottom-0 z-20 pt-4 pb-4">
            <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background via-background/95 to-transparent pointer-events-none" />
            <div className="relative max-w-2xl mx-auto px-4">
                {recordingActive ? (
                    <RecordingPanel
                        rec={rec}
                        sr={sr}
                        onCancel={handleCancel}
                        onStop={handleStop}
                        onSave={handleSave}
                        busy={busy}
                    />
                ) : mode === "voice" ? (
                    <div className="glass rounded-3xl p-3 flex items-center gap-2 shadow-xl shadow-black/5">
                        <Button
                            data-testid="dock-mode-text"
                            variant="ghost"
                            size="icon"
                            className="rounded-full h-12 w-12"
                            onClick={() => setMode("text")}
                            aria-label="Switch to text"
                        >
                            <KeyboardIcon />
                        </Button>
                        <button
                            data-testid="dock-record-btn"
                            onClick={handleStart}
                            className="flex-1 h-14 rounded-full bg-primary text-primary-foreground font-medium flex items-center justify-center gap-3 hover:translate-y-[-1px] transition-transform shadow-lg shadow-primary/25"
                        >
                            <Mic className="w-5 h-5" />
                            Hold a thought — record
                        </button>
                    </div>
                ) : (
                    <TextDock onSend={onSendText} setMode={setMode} busy={busy} />
                )}
                <p className="text-[11px] text-center text-muted-foreground mt-3">
                    PericL listens privately. Your entries stay yours.
                </p>
            </div>
        </div>
    );
}

function KeyboardIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="20" height="14" x="2" y="6" rx="2" />
            <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
        </svg>
    );
}

function RecordingPanel({ rec, sr, onCancel, onStop, onSave, busy }) {
    const canvasRef = useRef(null);
    const rafRef = useRef(null);

    useEffect(() => {
        if (!rec.analyser || !canvasRef.current || rec.isPaused || !rec.isRecording) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        const buf = new Uint8Array(rec.analyser.frequencyBinCount);

        const draw = () => {
            rafRef.current = requestAnimationFrame(draw);
            rec.analyser.getByteFrequencyData(buf);
            const dpr = window.devicePixelRatio || 1;
            const w = canvas.clientWidth * dpr;
            const h = canvas.clientHeight * dpr;
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
            }
            ctx.clearRect(0, 0, w, h);
            const bars = 36;
            const bw = w / bars;
            const styles = getComputedStyle(document.documentElement);
            const primary = styles.getPropertyValue("--primary").trim();
            for (let i = 0; i < bars; i++) {
                const idx = Math.floor((i / bars) * buf.length);
                const v = buf[idx] / 255;
                const bh = Math.max(4 * dpr, v * h * 0.85);
                const x = i * bw;
                const y = (h - bh) / 2;
                ctx.fillStyle = `hsl(${primary})`;
                ctx.beginPath();
                const r = Math.min(bw / 2, 4 * dpr);
                ctx.roundRect(x + 2 * dpr, y, bw - 4 * dpr, bh, r);
                ctx.fill();
            }
        };
        draw();
        return () => rafRef.current && cancelAnimationFrame(rafRef.current);
    }, [rec.analyser, rec.isPaused, rec.isRecording]);

    const has = rec.audioBlob;

    return (
        <div className="glass rounded-3xl p-4 shadow-2xl shadow-black/10 animate-float-in">
            {!has ? (
                <>
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 text-xs">
                            <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
                            <span className="font-medium uppercase tracking-wider">
                                {rec.isPaused ? "Paused" : "Listening"}
                            </span>
                        </div>
                        <span className="text-xs font-mono text-muted-foreground">{fmtTime(rec.seconds)}</span>
                    </div>
                    <canvas ref={canvasRef} className="w-full h-14 mb-2" />
                    {sr.transcript && (
                        <div
                            data-testid="recording-transcript"
                            className="bg-muted/60 rounded-2xl px-4 py-3 text-sm leading-relaxed mb-3 max-h-28 overflow-y-auto"
                        >
                            {sr.transcript}
                        </div>
                    )}
                    <div className="flex gap-2">
                        <Button
                            data-testid="recording-cancel"
                            variant="ghost"
                            size="icon"
                            className="rounded-full h-12 w-12"
                            onClick={onCancel}
                        >
                            <X className="w-5 h-5" />
                        </Button>
                        {rec.isPaused ? (
                            <Button
                                data-testid="recording-resume"
                                variant="outline"
                                onClick={rec.resume}
                                className="rounded-full h-12 flex-1"
                            >
                                <Play className="w-4 h-4 mr-2" />
                                Resume
                            </Button>
                        ) : (
                            <Button
                                data-testid="recording-pause"
                                variant="outline"
                                onClick={rec.pause}
                                className="rounded-full h-12 flex-1"
                            >
                                <Pause className="w-4 h-4 mr-2" />
                                Pause
                            </Button>
                        )}
                        <Button
                            data-testid="recording-stop"
                            onClick={onStop}
                            className="rounded-full h-12 flex-1 bg-destructive hover:bg-destructive/90"
                        >
                            <Square className="w-4 h-4 mr-2 fill-current" />
                            Stop
                        </Button>
                    </div>
                </>
            ) : (
                <>
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium">Recording captured</span>
                        <span className="text-xs font-mono text-muted-foreground">{fmtTime(rec.seconds)}</span>
                    </div>
                    {sr.transcript && (
                        <div className="bg-muted/60 rounded-2xl px-4 py-3 text-sm leading-relaxed mb-3 max-h-28 overflow-y-auto">
                            {sr.transcript}
                        </div>
                    )}
                    <div className="flex gap-2">
                        <Button
                            data-testid="recording-discard"
                            variant="outline"
                            onClick={onCancel}
                            className="rounded-full h-12 flex-1"
                            disabled={busy}
                        >
                            <X className="w-4 h-4 mr-2" />
                            Discard
                        </Button>
                        <Button
                            data-testid="recording-save"
                            onClick={onSave}
                            disabled={busy}
                            className="rounded-full h-12 flex-1"
                        >
                            <Check className="w-4 h-4 mr-2" />
                            {busy ? "Sorting…" : "Save & sort"}
                        </Button>
                    </div>
                </>
            )}
        </div>
    );
}

function TextDock({ onSend, setMode, busy }) {
    const [v, setV] = useState("");

    const send = async () => {
        const t = v.trim();
        if (!t || busy) return;
        await onSend(t);
        setV("");
    };

    return (
        <div className="glass rounded-3xl p-2 flex items-end gap-2 shadow-xl shadow-black/5">
            <Button
                data-testid="dock-mode-voice"
                variant="ghost"
                size="icon"
                className="rounded-full h-12 w-12 shrink-0"
                onClick={() => setMode("voice")}
                aria-label="Switch to voice"
            >
                <Mic className="w-5 h-5" />
            </Button>
            <textarea
                data-testid="dock-text-input"
                value={v}
                onChange={(e) => setV(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                    }
                }}
                placeholder="What's on your mind…"
                rows={1}
                className="flex-1 resize-none bg-transparent border-0 focus:outline-none px-2 py-3 text-base placeholder:text-muted-foreground max-h-32"
            />
            <Button
                data-testid="dock-send-btn"
                onClick={send}
                disabled={busy || !v.trim()}
                size="icon"
                className="rounded-full h-12 w-12 shrink-0"
            >
                <SendIcon />
            </Button>
        </div>
    );
}

function SendIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m22 2-7 20-4-9-9-4z" />
            <path d="M22 2 11 13" />
        </svg>
    );
}
