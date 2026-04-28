import { useEffect, useRef, useState } from "react";

/** Browser Speech Recognition for live transcript preview while recording. */
export function useSpeechRecognition() {
    const [transcript, setTranscript] = useState("");
    const [supported, setSupported] = useState(false);
    const recRef = useRef(null);

    useEffect(() => {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        setSupported(!!SR);
    }, []);

    const start = () => {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return;
        try {
            const r = new SR();
            r.continuous = true;
            r.interimResults = true;
            r.lang = "en-US";
            let finalText = "";
            r.onresult = (e) => {
                let interim = "";
                for (let i = e.resultIndex; i < e.results.length; i++) {
                    const tr = e.results[i][0].transcript;
                    if (e.results[i].isFinal) finalText += tr + " ";
                    else interim += tr;
                }
                setTranscript((finalText + interim).trim());
            };
            r.onerror = () => {};
            r.onend = () => {};
            r.start();
            recRef.current = r;
        } catch {}
    };

    const stop = () => {
        try { recRef.current?.stop(); } catch {}
        recRef.current = null;
    };

    const reset = () => setTranscript("");

    return { transcript, supported, start, stop, reset };
}
