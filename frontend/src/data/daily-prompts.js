// Daily reflection prompt bank — ported from original PericL repo.
export const promptCategories = {
    reflection: [
        "What's one thing you learned about yourself today?",
        "What moment today made you feel most alive?",
        "What challenge did you face today and how did you respond?",
        "What are you grateful for right now?",
        "What would you tell your past self from a week ago?",
        "What pattern in your behavior did you notice today?",
        "What small win can you celebrate today?",
        "What did you do today that aligned with your values?",
        "What conversation or interaction stood out to you today?",
        "What's one thing you wish you'd done differently today?",
    ],
    growth: [
        "What's one fear you could face today?",
        "What skill are you working on and what's your next small step?",
        "What's holding you back from your goals right now?",
        "What would you attempt if you knew you couldn't fail?",
        "What uncomfortable conversation have you been avoiding?",
        "What's one habit you want to build? What's the smallest version of it?",
        "What feedback have you received that you've been resisting?",
        "What would stepping outside your comfort zone look like today?",
        "What limiting belief is affecting you right now?",
        "What would your future self thank you for doing today?",
    ],
    values: [
        "What matters most to you right now?",
        "How did you show up as the person you want to be today?",
        "What decision are you facing and what do your values say?",
        "What's a value you hold that you haven't acted on lately?",
        "Who do you want to become and what's one small step toward that?",
        "What are you tolerating that doesn't align with who you are?",
        "What's your definition of success right now?",
        "What relationship in your life needs attention?",
        "What would living authentically look like for you today?",
        "What legacy do you want to leave and how does today contribute?",
    ],
    mindfulness: [
        "What physical sensations do you notice right now?",
        "What thoughts keep repeating in your mind?",
        "What emotion are you experiencing and where do you feel it?",
        "What are you avoiding thinking about?",
        "What would you do if you had zero fear right now?",
        "What's the difference between what you're doing and what you want to be doing?",
        "What thought pattern would you like to change?",
        "What are you telling yourself about your current situation?",
        "What judgments are you holding about yourself?",
        "What would self-compassion look like for you right now?",
    ],
    action: [
        "What's one action you can take today toward your biggest goal?",
        "What's been on your to-do list too long?",
        "What would make today feel like a win?",
        "Who could you reach out to today that you've been meaning to contact?",
        "What's one thing you can say no to today?",
        "What would investing in yourself look like today?",
        "What procrastination are you ready to address?",
        "What boundary do you need to set?",
        "What would moving forward look like, even if it's imperfect?",
        "What's one thing you can do today that your future self will appreciate?",
    ],
    relationships: [
        "Who could you show appreciation for today?",
        "What relationship needs more attention from you?",
        "How can you be more present with someone today?",
        "What conflict or tension are you carrying?",
        "How did you make someone's day better recently?",
        "What do you need to communicate that you've been holding back?",
        "Who inspires you and what have you learned from them?",
        "What relationship pattern do you keep repeating?",
        "How can you be more vulnerable with someone you trust?",
        "Who needs your help right now?",
    ],
};

export const personalityPrompts = {
    I: ["What insights came from your alone time today?", "How did you protect your energy today?", "What thoughts have you been processing internally?", "When did you feel most recharged today?"],
    E: ["How did your interactions energize you today?", "What did you learn from connecting with others?", "How did you contribute to the groups you were part of?", "What conversation sparked new ideas for you?"],
    S: ["What practical step did you take toward your goals?", "What concrete details did you notice today that others missed?", "How did your experience guide your decisions today?", "What worked well that you can replicate?"],
    N: ["What patterns or possibilities did you notice today?", "How does today connect to your bigger vision?", "What innovative idea came to you?", "What future scenario are you imagining?"],
    T: ["What logical problem did you solve today?", "What principle or system did you refine?", "Where did you prioritize truth over harmony?", "What objective analysis led to a good decision?"],
    F: ["How did you honor your values today?", "Whose wellbeing did you consider in your decisions?", "What emotional impact did your actions have?", "How did you create harmony in a situation?"],
    J: ["What did you complete today?", "How did your planning pay off?", "What structure or organization improved your day?", "What closure did you achieve?"],
    P: ["What opportunity did you seize by staying flexible?", "How did spontaneity enhance your day?", "What new information changed your perspective?", "Where did you adapt successfully?"],
};

export function selectDailyPrompt(personalityType) {
    const cats = Object.keys(promptCategories);
    const cat = cats[Math.floor(Math.random() * cats.length)];
    if (personalityType && Math.random() < 0.3) {
        const all = personalityType.split("").flatMap((l) => personalityPrompts[l] || []);
        if (all.length) return { text: all[Math.floor(Math.random() * all.length)], type: "personality" };
    }
    const list = promptCategories[cat];
    return { text: list[Math.floor(Math.random() * list.length)], type: cat };
}
