import { useEffect, useState } from "react";

/**
 * Floating mood-driven emoji burst.
 * Spawns positive emojis based on `mood`. Even negative moods spawn supportive,
 * comforting emojis (the goal is mood-enhancement / positivity, not amplification).
 *
 * Usage: <MoodEmojiBurst trigger={moodKey} mood={mood} />
 *  - `trigger` should be a unique value per burst (e.g., message id), so each
 *    new send creates a fresh batch.
 */

const MOOD_EMOJIS = {
    happy: ["✨", "🌟", "💛", "😊", "🌻", "🎈", "🌈", "💫"],
    excited: ["🎉", "🚀", "⚡", "🔥", "🌟", "🎊", "💥", "💫"],
    calm: ["🌿", "🕊️", "💚", "🍃", "🌙", "☁️", "💧", "✨"],
    focused: ["🎯", "💪", "📌", "🌟", "⚙️", "🧭", "💡", "✨"],
    sad: ["🤍", "💙", "🫂", "🌧️", "🕊️", "☁️", "💧", "✨"],         // gentle, supportive
    stressed: ["🌿", "🫂", "🍵", "🕯️", "💚", "☁️", "🌬️", "✨"],   // calming
    neutral: ["✨", "🌿", "💫", "🌟", "💛"],
};

const COUNT = 14;

function randInt(min, max) {
    return min + Math.floor(Math.random() * (max - min));
}

export default function MoodEmojiBurst({ trigger, mood }) {
    const [emojis, setEmojis] = useState([]);

    useEffect(() => {
        if (!trigger) return;
        const pool = MOOD_EMOJIS[mood] || MOOD_EMOJIS.happy;
        const batch = Array.from({ length: COUNT }).map((_, i) => ({
            id: `${trigger}-${i}`,
            ch: pool[Math.floor(Math.random() * pool.length)],
            left: randInt(4, 96),                 // %
            duration: randInt(3800, 6200),        // ms
            delay: randInt(0, 700),               // ms
            size: randInt(22, 38),                // px
            sway: randInt(-40, 40),               // px lateral drift
            rotate: randInt(-25, 25),             // deg
        }));
        setEmojis(batch);
        const totalLife = 7200;
        const t = setTimeout(() => setEmojis([]), totalLife);
        return () => clearTimeout(t);
    }, [trigger, mood]);

    if (!emojis.length) return null;

    return (
        <div
            className="pointer-events-none fixed inset-0 z-40 overflow-hidden"
            data-testid="mood-emoji-burst"
        >
            {emojis.map((e) => (
                <span
                    key={e.id}
                    style={{
                        position: "absolute",
                        left: `${e.left}%`,
                        bottom: "-40px",
                        fontSize: `${e.size}px`,
                        opacity: 0,
                        animation: `mood-float-${e.id.replace(/[^a-zA-Z0-9]/g, "")} ${e.duration}ms ease-out ${e.delay}ms forwards`,
                        willChange: "transform, opacity",
                        textShadow: "0 1px 6px rgba(0,0,0,0.15)",
                    }}
                >
                    {e.ch}
                    <style>{`
                        @keyframes mood-float-${e.id.replace(/[^a-zA-Z0-9]/g, "")} {
                            0%   { transform: translate(0, 0) rotate(0deg);                 opacity: 0; }
                            12%  { opacity: 1; }
                            85%  { opacity: 1; }
                            100% {
                                transform:
                                    translate(${e.sway}px, calc(-100vh - 40px))
                                    rotate(${e.rotate}deg);
                                opacity: 0;
                            }
                        }
                    `}</style>
                </span>
            ))}
        </div>
    );
}
