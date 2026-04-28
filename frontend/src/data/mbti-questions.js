// PericL — MBTI question bank (ported from original PericL repo)
export const mbtiQuestions = [
    // Extraversion (E) vs Introversion (I)
    { id: 1, text: "After a long day, you feel recharged by:", dimension: "EI", options: [{ text: "Going out with friends or being around people", score: "E" }, { text: "Having quiet time alone to reflect", score: "I" }] },
    { id: 2, text: "At social gatherings, you typically:", dimension: "EI", options: [{ text: "Meet new people and enjoy group conversations", score: "E" }, { text: "Stick with people you know and prefer one-on-one talks", score: "I" }] },
    { id: 3, text: "When solving a problem, you prefer to:", dimension: "EI", options: [{ text: "Talk it through with others and brainstorm out loud", score: "E" }, { text: "Think it through internally before discussing", score: "I" }] },
    { id: 4, text: "Your ideal weekend involves:", dimension: "EI", options: [{ text: "Social activities and spending time with people", score: "E" }, { text: "Personal hobbies and quiet activities", score: "I" }] },
    { id: 5, text: "In a new environment, you:", dimension: "EI", options: [{ text: "Jump right in and start interacting", score: "E" }, { text: "Observe first and warm up gradually", score: "I" }] },
    { id: 6, text: "You gain energy from:", dimension: "EI", options: [{ text: "Action, interaction, and external stimulation", score: "E" }, { text: "Ideas, reflection, and inner thoughts", score: "I" }] },
    { id: 7, text: "Your phone notifications are:", dimension: "EI", options: [{ text: "A welcome connection to people and the world", score: "E" }, { text: "Sometimes an unwelcome interruption", score: "I" }] },
    { id: 8, text: "When learning something new, you prefer:", dimension: "EI", options: [{ text: "Group discussions and collaborative learning", score: "E" }, { text: "Individual study and self-paced learning", score: "I" }] },
    // Sensing (S) vs Intuition (N)
    { id: 9, text: "You tend to focus on:", dimension: "SN", options: [{ text: "Concrete facts and practical realities", score: "S" }, { text: "Patterns, meanings, and future possibilities", score: "N" }] },
    { id: 10, text: "When following instructions, you prefer:", dimension: "SN", options: [{ text: "Step-by-step details and proven methods", score: "S" }, { text: "The big picture and room for interpretation", score: "N" }] },
    { id: 11, text: "You're more interested in:", dimension: "SN", options: [{ text: "What is real and present now", score: "S" }, { text: "What could be possible in the future", score: "N" }] },
    { id: 12, text: "When someone tells you a story, you notice:", dimension: "SN", options: [{ text: "The specific details and facts", score: "S" }, { text: "The underlying themes and connections", score: "N" }] },
    { id: 13, text: "You trust:", dimension: "SN", options: [{ text: "Experience and what has worked before", score: "S" }, { text: "Intuition and exploring new approaches", score: "N" }] },
    { id: 14, text: "Your thinking style is more:", dimension: "SN", options: [{ text: "Literal and focused on what's observable", score: "S" }, { text: "Metaphorical and focused on meanings", score: "N" }] },
    { id: 15, text: "When planning, you prefer to:", dimension: "SN", options: [{ text: "Start with practical details and logistics", score: "S" }, { text: "Start with vision and overall concepts", score: "N" }] },
    { id: 16, text: "You're drawn to:", dimension: "SN", options: [{ text: "Routine and familiarity", score: "S" }, { text: "Novelty and innovation", score: "N" }] },
    // Thinking (T) vs Feeling (F)
    { id: 17, text: "When making decisions, you prioritize:", dimension: "TF", options: [{ text: "Logical analysis and objective criteria", score: "T" }, { text: "Personal values and impact on people", score: "F" }] },
    { id: 18, text: "You're more motivated by:", dimension: "TF", options: [{ text: "Achievement and competence", score: "T" }, { text: "Harmony and helping others", score: "F" }] },
    { id: 19, text: "In conflicts, you tend to:", dimension: "TF", options: [{ text: "Stand firm on principles and logic", score: "T" }, { text: "Consider everyone's feelings and find compromise", score: "F" }] },
    { id: 20, text: "When giving feedback, you're more likely to:", dimension: "TF", options: [{ text: "Be direct and focus on what needs improvement", score: "T" }, { text: "Be tactful and consider the person's feelings", score: "F" }] },
    { id: 21, text: "You value being seen as:", dimension: "TF", options: [{ text: "Competent and rational", score: "T" }, { text: "Caring and empathetic", score: "F" }] },
    { id: 22, text: "When someone shares a problem, you first:", dimension: "TF", options: [{ text: "Analyze it and suggest solutions", score: "T" }, { text: "Listen and provide emotional support", score: "F" }] },
    { id: 23, text: "You make better decisions when considering:", dimension: "TF", options: [{ text: "Facts, logic, and objective outcomes", score: "T" }, { text: "Personal values and how it affects people", score: "F" }] },
    { id: 24, text: "In debates, you're more interested in:", dimension: "TF", options: [{ text: "Finding the truth through logical argument", score: "T" }, { text: "Understanding different perspectives", score: "F" }] },
    // Judging (J) vs Perceiving (P)
    { id: 25, text: "You prefer your life to be:", dimension: "JP", options: [{ text: "Structured and organized", score: "J" }, { text: "Flexible and spontaneous", score: "P" }] },
    { id: 26, text: "When working on a project, you:", dimension: "JP", options: [{ text: "Make a plan and work steadily toward completion", score: "J" }, { text: "Keep options open and work in bursts of energy", score: "P" }] },
    { id: 27, text: "Deadlines are:", dimension: "JP", options: [{ text: "Motivating — you work best with structure", score: "J" }, { text: "Stressful — you prefer flexibility", score: "P" }] },
    { id: 28, text: "Your workspace is typically:", dimension: "JP", options: [{ text: "Organized with everything in its place", score: "J" }, { text: "A bit messy but you know where things are", score: "P" }] },
    { id: 29, text: "When making plans with friends, you prefer:", dimension: "JP", options: [{ text: "Deciding details in advance", score: "J" }, { text: "Keeping it loose and seeing what happens", score: "P" }] },
    { id: 30, text: "You feel satisfied when:", dimension: "JP", options: [{ text: "Tasks are completed and checked off", score: "J" }, { text: "You have freedom to explore and adapt", score: "P" }] },
    { id: 31, text: "Your approach to life is more:", dimension: "JP", options: [{ text: "Planned and decided", score: "J" }, { text: "Open-ended and exploratory", score: "P" }] },
    { id: 32, text: "When traveling, you prefer to:", dimension: "JP", options: [{ text: "Have an itinerary and reservations", score: "J" }, { text: "Go with the flow and discover as you go", score: "P" }] },
];

export const personalityTypes = {
    ISTJ: { name: "The Inspector", description: "Practical, fact-minded, and reliable. You value tradition, loyalty, and order. Known for being responsible and getting things done.", strengths: ["Dependable and thorough", "Strong sense of duty", "Detail-oriented", "Logical decision-making"], growthAreas: ["Flexibility with change", "Expressing emotions", "Considering others' perspectives", "Spontaneity"] },
    ISFJ: { name: "The Protector", description: "Warm, considerate, and dedicated. You have a strong sense of duty and care deeply about others' wellbeing. You create stability through practical support.", strengths: ["Supportive and reliable", "Strong memory for details", "Loyal and committed", "Practical helper"], growthAreas: ["Setting boundaries", "Accepting change", "Voicing your needs", "Taking risks"] },
    INFJ: { name: "The Counselor", description: "Insightful, principled, and idealistic. You seek meaning and connection, using your intuition to understand people and inspire positive change.", strengths: ["Deep empathy", "Vision for the future", "Strong values", "Insightful about people"], growthAreas: ["Practical implementation", "Self-care", "Accepting imperfection", "Conflict engagement"] },
    INTJ: { name: "The Mastermind", description: "Strategic, independent, and innovative. You see patterns and possibilities, designing systems and pursuing knowledge with determination.", strengths: ["Strategic thinking", "Independent work", "Long-term vision", "High standards"], growthAreas: ["Social awareness", "Patience with others", "Emotional expression", "Flexibility"] },
    ISTP: { name: "The Craftsperson", description: "Practical, analytical, and adaptable. You excel at understanding how things work and solving problems with hands-on skill.", strengths: ["Problem-solving", "Calm under pressure", "Logical analysis", "Hands-on skills"], growthAreas: ["Long-term planning", "Emotional expression", "Following through", "Social connection"] },
    ISFP: { name: "The Composer", description: "Gentle, sensitive, and artistic. You live in the present moment, expressing yourself through action and creation while staying true to your values.", strengths: ["Aesthetic sensitivity", "Adaptability", "Strong values", "Observant of details"], growthAreas: ["Long-term planning", "Assertiveness", "Criticism handling", "Decision-making"] },
    INFP: { name: "The Healer", description: "Idealistic, creative, and empathetic. You seek authenticity and meaning, guided by deep personal values and a desire to help others.", strengths: ["Deep values", "Creative expression", "Empathy", "Open-mindedness"], growthAreas: ["Practical matters", "Criticism handling", "Decisiveness", "Self-promotion"] },
    INTP: { name: "The Architect", description: "Analytical, innovative, and curious. You love exploring ideas and building logical frameworks, always seeking to understand the underlying principles.", strengths: ["Logical analysis", "Innovative thinking", "Intellectual curiosity", "Objectivity"], growthAreas: ["Emotional awareness", "Follow-through", "Social skills", "Practical application"] },
    ESTP: { name: "The Dynamo", description: "Energetic, practical, and bold. You thrive on action and new experiences, solving problems through direct engagement with the world.", strengths: ["Action-oriented", "Adaptability", "Problem-solving", "Charismatic"], growthAreas: ["Long-term thinking", "Patience", "Sensitivity to others", "Planning"] },
    ESFP: { name: "The Performer", description: "Spontaneous, enthusiastic, and people-oriented. You bring joy and excitement to life, connecting with others through warmth and shared experiences.", strengths: ["Enthusiasm", "Social skills", "Adaptability", "Living in the moment"], growthAreas: ["Long-term planning", "Focus", "Criticism handling", "Depth over breadth"] },
    ENFP: { name: "The Champion", description: "Enthusiastic, creative, and people-focused. You see possibilities everywhere and inspire others with your passion and vision for what could be.", strengths: ["Creativity", "People skills", "Enthusiasm", "Open-mindedness"], growthAreas: ["Follow-through", "Focus", "Organization", "Practical details"] },
    ENTP: { name: "The Visionary", description: "Innovative, curious, and intellectually playful. You love debating ideas and exploring new possibilities, challenging conventional thinking.", strengths: ["Innovative thinking", "Quick thinking", "Charismatic", "Strategic vision"], growthAreas: ["Follow-through", "Sensitivity", "Patience", "Routine tasks"] },
    ESTJ: { name: "The Supervisor", description: "Organized, practical, and results-oriented. You excel at bringing order and efficiency, making decisions based on logic and proven methods.", strengths: ["Leadership", "Organization", "Decisiveness", "Efficiency"], growthAreas: ["Flexibility", "Emotional awareness", "Considering alternatives", "Patience"] },
    ESFJ: { name: "The Provider", description: "Warm, organized, and helpful. You create harmony through caring for others and maintaining traditions, building strong communities.", strengths: ["Supportive nature", "Organization", "Social awareness", "Loyalty"], growthAreas: ["Criticism handling", "Change acceptance", "Assertiveness", "Self-focus"] },
    ENFJ: { name: "The Teacher", description: "Charismatic, empathetic, and inspiring. You understand people deeply and guide them toward their potential, creating positive change through connection.", strengths: ["Leadership", "Empathy", "Communication", "Vision for others"], growthAreas: ["Self-care", "Boundary-setting", "Objectivity", "Accepting conflict"] },
    ENTJ: { name: "The Commander", description: "Strategic, assertive, and goal-driven. You see the big picture and organize people and resources to achieve ambitious objectives efficiently.", strengths: ["Strategic leadership", "Decisiveness", "Efficiency", "Confidence"], growthAreas: ["Patience", "Emotional sensitivity", "Flexibility", "Work-life balance"] },
};

export function computePersonalityType(scores) {
    return [
        scores.E >= scores.I ? "E" : "I",
        scores.S >= scores.N ? "S" : "N",
        scores.T >= scores.F ? "T" : "F",
        scores.J >= scores.P ? "J" : "P",
    ].join("");
}
