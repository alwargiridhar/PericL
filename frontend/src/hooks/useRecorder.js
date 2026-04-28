import { useEffect, useRef, useState } from "react";

/** Web Audio recorder hook with optional analyser for waveform. */
export function useRecorder() {
    const [isRecording, setIsRecording] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [seconds, setSeconds] = useState(0);
    const [audioBlob, setAudioBlob] = useState(null);
    const [analyser, setAnalyser] = useState(null);
    const [error, setError] = useState(null);

    const mediaRecorderRef = useRef(null);
    const chunksRef = useRef([]);
    const streamRef = useRef(null);
    const audioCtxRef = useRef(null);
    const tickRef = useRef(null);

    const cleanup = () => {
        if (tickRef.current) {
            clearInterval(tickRef.current);
            tickRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
        }
        if (audioCtxRef.current) {
            try { audioCtxRef.current.close(); } catch {}
            audioCtxRef.current = null;
        }
        setAnalyser(null);
    };

    const start = async () => {
        setError(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            const mr = new MediaRecorder(stream);
            chunksRef.current = [];
            mr.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };
            mr.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: "audio/webm" });
                setAudioBlob(blob);
            };
            mr.start();
            mediaRecorderRef.current = mr;

            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            audioCtxRef.current = ctx;
            const src = ctx.createMediaStreamSource(stream);
            const an = ctx.createAnalyser();
            an.fftSize = 64;
            src.connect(an);
            setAnalyser(an);

            setIsRecording(true);
            setIsPaused(false);
            setSeconds(0);
            tickRef.current = setInterval(() => {
                setSeconds((s) => s + 1);
            }, 1000);
        } catch (e) {
            setError(e.message || "Microphone unavailable");
        }
    };

    const pause = () => {
        if (mediaRecorderRef.current && isRecording && !isPaused) {
            mediaRecorderRef.current.pause();
            setIsPaused(true);
            if (tickRef.current) clearInterval(tickRef.current);
        }
    };

    const resume = () => {
        if (mediaRecorderRef.current && isRecording && isPaused) {
            mediaRecorderRef.current.resume();
            setIsPaused(false);
            tickRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
        }
    };

    const stop = () => {
        if (mediaRecorderRef.current && (isRecording || isPaused)) {
            try { mediaRecorderRef.current.stop(); } catch {}
        }
        setIsRecording(false);
        setIsPaused(false);
        cleanup();
    };

    const reset = () => {
        setAudioBlob(null);
        setSeconds(0);
        setIsRecording(false);
        setIsPaused(false);
        chunksRef.current = [];
        cleanup();
    };

    useEffect(() => () => cleanup(), []);

    return { isRecording, isPaused, seconds, audioBlob, analyser, error, start, pause, resume, stop, reset };
}
