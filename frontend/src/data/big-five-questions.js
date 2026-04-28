// PericL — Big Five (OCEAN) inventory.
// 25 statements (5 per trait), Likert 1..5 (Strongly disagree → Strongly agree).
// `reverse: true` flips the score (6 - s) before averaging.
export const bigFiveQuestions = [
    // Openness
    { id: 1, trait: "O", reverse: false, text: "I have a vivid imagination." },
    { id: 2, trait: "O", reverse: false, text: "I'm curious about many different things." },
    { id: 3, trait: "O", reverse: true, text: "I avoid abstract ideas and theories." },
    { id: 4, trait: "O", reverse: false, text: "I enjoy thinking about deep questions." },
    { id: 5, trait: "O", reverse: false, text: "I appreciate art, music, or beauty." },
    // Conscientiousness
    { id: 6, trait: "C", reverse: false, text: "I follow through on what I say I'll do." },
    { id: 7, trait: "C", reverse: false, text: "I keep my space and tasks organised." },
    { id: 8, trait: "C", reverse: true, text: "I leave things until the last minute." },
    { id: 9, trait: "C", reverse: false, text: "I work hard, even when no one is watching." },
    { id: 10, trait: "C", reverse: true, text: "I get distracted easily and lose focus." },
    // Extraversion
    { id: 11, trait: "E", reverse: false, text: "I feel energised after time with people." },
    { id: 12, trait: "E", reverse: false, text: "I start conversations easily." },
    { id: 13, trait: "E", reverse: true, text: "I prefer to stay quietly in the background." },
    { id: 14, trait: "E", reverse: false, text: "I enjoy being the centre of attention sometimes." },
    { id: 15, trait: "E", reverse: true, text: "I need a lot of time alone to recover." },
    // Agreeableness
    { id: 16, trait: "A", reverse: false, text: "I'm interested in other people's lives." },
    { id: 17, trait: "A", reverse: false, text: "I try to find common ground in disagreements." },
    { id: 18, trait: "A", reverse: true, text: "I can be blunt or harsh with people." },
    { id: 19, trait: "A", reverse: false, text: "I make people feel comfortable around me." },
    { id: 20, trait: "A", reverse: true, text: "I put my own needs first most of the time." },
    // Neuroticism
    { id: 21, trait: "N", reverse: false, text: "Small setbacks can ruin my day." },
    { id: 22, trait: "N", reverse: false, text: "I worry about things even when there's no real reason." },
    { id: 23, trait: "N", reverse: true, text: "I stay calm under pressure." },
    { id: 24, trait: "N", reverse: false, text: "I get upset more easily than most." },
    { id: 25, trait: "N", reverse: true, text: "My mood is steady most days." },
];

export const LIKERT_OPTIONS = [
    { score: 1, text: "Strongly disagree" },
    { score: 2, text: "Disagree" },
    { score: 3, text: "Neutral" },
    { score: 4, text: "Agree" },
    { score: 5, text: "Strongly agree" },
];

export const TRAIT_NAMES = {
    O: "Openness",
    C: "Conscientiousness",
    E: "Extraversion",
    A: "Agreeableness",
    N: "Neuroticism",
};

export const TRAIT_DESCRIPTIONS = {
    O: "Curiosity, imagination, and openness to new experiences.",
    C: "Discipline, follow-through, and the steady muscle of doing.",
    E: "Where you draw energy — outward with people, or inward with ideas.",
    A: "How warmly you move toward others and find common ground.",
    N: "Emotional weather — how often storms pass through, and how long they stay.",
};
