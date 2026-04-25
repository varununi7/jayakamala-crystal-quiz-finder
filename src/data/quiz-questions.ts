// Sheet-driven quiz: each option declares which TAGS (column tokens) it boosts.
// The edge function scans every crystal in the spreadsheet and adds the weight
// to any crystal whose matching column contains the tag value (case-insensitive substring).
// Add/edit/remove crystals in the sheet — results adapt automatically.

export type Tag = {
  field: "functions" | "collections" | "chakra" | "color" | "element";
  value: string;
  weight: number;
};

export type QuizOption = {
  icon: string;
  text: string;
  tags: Tag[];
};

export type QuizQuestion = {
  text: string;
  options: QuizOption[];
  multiSelect?: boolean;
  maxSelections?: number;
  skippable?: boolean;
};

const f = (v: string, w = 3): Tag => ({ field: "functions", value: v, weight: w });
const c = (v: string, w = 3): Tag => ({ field: "collections", value: v, weight: w });
const ch = (v: string, w = 3): Tag => ({ field: "chakra", value: v, weight: w });
const co = (v: string, w = 3): Tag => ({ field: "color", value: v, weight: w });
const el = (v: string, w = 3): Tag => ({ field: "element", value: v, weight: w });

export const questions: QuizQuestion[] = [
  {
    text: "What's your biggest challenge right now?",
    options: [
      { icon: "😰", text: "Anxiety or overwhelming stress", tags: [f("calm", 3), f("anxiety", 3), f("stress", 2), c("calming", 2)] },
      { icon: "⚡", text: "Low energy, focus or motivation", tags: [f("energy", 3), f("focus", 3), f("motivation", 2), c("energizing", 2)] },
      { icon: "😴", text: "Poor sleep or restlessness", tags: [f("sleep", 3), f("calm", 2), f("rest", 2)] },
      { icon: "💬", text: "Communication or relationships", tags: [f("communication", 3), f("relationship", 3), f("love", 1), ch("throat", 2), ch("heart", 1)] },
      { icon: "🌫️", text: "Clarity or finding my purpose", tags: [f("clarity", 3), f("purpose", 2), f("focus", 2)] },
      { icon: "🛡️", text: "Negativity or feeling unprotected", tags: [f("protection", 3), f("grounding", 2), c("protection", 2)] },
    ],
  },
  {
    text: "How would you describe your emotional state lately?",
    multiSelect: true,
    maxSelections: 2,
    options: [
      { icon: "🌊", text: "Overwhelmed — too much, too fast", tags: [f("calm", 2), f("stress", 2), f("balance", 1)] },
      { icon: "🍃", text: "Scattered — can't concentrate", tags: [f("focus", 3), f("clarity", 2), f("grounding", 2)] },
      { icon: "❄️", text: "Numb or disconnected", tags: [f("grounding", 2), f("energy", 2), f("heart", 1)] },
      { icon: "🔥", text: "Restless or easily agitated", tags: [f("calm", 3), f("balance", 2)] },
      { icon: "✨", text: "Balanced, but ready to grow", tags: [f("growth", 2), f("intuition", 2)] },
    ],
  },
  {
    text: "Which area of life do you most want to improve?",
    multiSelect: true,
    maxSelections: 2,
    options: [
      { icon: "💼", text: "Work, career & productivity", tags: [c("career", 3), c("abundance", 2), f("focus", 2), f("motivation", 2)] },
      { icon: "❤️", text: "Love, friendships & relationships", tags: [c("love", 3), c("relationships", 2), f("love", 2), ch("heart", 2)] },
      { icon: "🌿", text: "Health & emotional wellbeing", tags: [c("healing", 3), c("wellness", 2), f("healing", 2)] },
      { icon: "🌙", text: "Spiritual growth & intuition", tags: [c("spiritual", 3), f("intuition", 3), f("meditation", 2), ch("crown", 2), ch("third eye", 2)] },
      { icon: "🎨", text: "Creative expression & confidence", tags: [c("creativity", 3), f("confidence", 2), f("expression", 2), ch("sacral", 2)] },
    ],
  },
  {
    text: "When do you most need crystal support?",
    skippable: true,
    options: [
      { icon: "☀️", text: "Morning — to energise my day", tags: [f("energy", 3), f("motivation", 2)] },
      { icon: "🌙", text: "Evening — to wind down and sleep", tags: [f("sleep", 3), f("calm", 2)] },
      { icon: "⏰", text: "All day — ongoing steady support", tags: [f("protection", 2), f("grounding", 2), f("balance", 2)] },
      { icon: "🧘", text: "During meditation or quiet time", tags: [f("meditation", 3), f("intuition", 2), c("spiritual", 2)] },
    ],
  },
  {
    text: "When stress hits, how do you typically respond?",
    multiSelect: true,
    maxSelections: 2,
    options: [
      { icon: "🌀", text: "I overthink everything", tags: [f("clarity", 3), f("calm", 2), ch("third eye", 1)] },
      { icon: "🐢", text: "I shut down or withdraw", tags: [f("energy", 2), f("confidence", 2), f("heart", 1)] },
      { icon: "💥", text: "I feel it physically — tight chest, headaches", tags: [f("calm", 3), f("healing", 2)] },
      { icon: "🏃", text: "I push through but burn out quickly", tags: [f("balance", 2), f("protection", 2), f("grounding", 2)] },
      { icon: "🌊", text: "I stay mostly calm and adapt", tags: [f("balance", 2), f("intuition", 1)] },
    ],
  },
  {
    text: "Which element resonates with you most?",
    options: [
      { icon: "🌍", text: "Earth — stability, roots, strength", tags: [el("earth", 3), f("grounding", 2)] },
      { icon: "💧", text: "Water — flow, intuition, emotion", tags: [el("water", 3), f("intuition", 2), f("emotion", 1)] },
      { icon: "🔥", text: "Fire — passion, courage, action", tags: [el("fire", 3), f("courage", 2), f("passion", 1)] },
      { icon: "🌬️", text: "Air — thought, freedom, expression", tags: [el("air", 3), f("expression", 2), f("communication", 1)] },
    ],
  },
  {
    text: "Which colour are you most drawn to right now?",
    options: [
      { icon: "💙", text: "Blue or purple — calm, mystical", tags: [co("blue", 3), co("purple", 2), co("violet", 2)] },
      { icon: "💚", text: "Green or teal — growth, harmony", tags: [co("green", 3), co("teal", 2)] },
      { icon: "🖤", text: "Black or grey — protection, power", tags: [co("black", 3), co("grey", 2), co("gray", 2)] },
      { icon: "🌸", text: "Pink or lavender — softness, love", tags: [co("pink", 3), co("lavender", 2)] },
      { icon: "🤍", text: "Clear or white — purity, clarity", tags: [co("clear", 3), co("white", 2)] },
    ],
  },
  {
    text: "Which word speaks to your soul right now?",
    multiSelect: true,
    maxSelections: 2,
    options: [
      { icon: "🦁", text: "Strength", tags: [f("strength", 3), f("courage", 2), ch("solar", 2)] },
      { icon: "🕊️", text: "Peace", tags: [f("peace", 3), f("calm", 2), ch("crown", 1)] },
      { icon: "🔍", text: "Clarity", tags: [f("clarity", 3), ch("third eye", 2)] },
      { icon: "💗", text: "Love", tags: [f("love", 3), ch("heart", 3)] },
      { icon: "🎤", text: "Truth", tags: [f("truth", 3), f("communication", 2), ch("throat", 3)] },
    ],
  },
  {
    text: "Where do you want to keep or use your crystal?",
    skippable: true,
    options: [
      { icon: "💎", text: "Wear it as a bracelet or jewellery", tags: [c("jewellery", 3), c("jewelry", 3), c("wearable", 2)] },
      { icon: "🛏️", text: "By my bed for sleep", tags: [f("sleep", 3), f("calm", 2)] },
      { icon: "💻", text: "On my desk while I work", tags: [c("career", 2), f("focus", 2), f("protection", 1)] },
      { icon: "🕯️", text: "During meditation or rituals", tags: [f("meditation", 3), c("spiritual", 2)] },
      { icon: "👜", text: "In my pocket or bag", tags: [f("protection", 2), f("grounding", 2)] },
    ],
  },
];
