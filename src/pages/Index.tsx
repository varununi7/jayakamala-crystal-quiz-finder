import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { questions, type Tag } from "@/data/quiz-questions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, Moon, Star, Gem, Mail, ArrowLeft, ArrowRight, Heart, Check } from "lucide-react";

type Screen = "landing" | "capture" | "quiz" | "loading" | "results";

interface Recommendation {
  name: string;
  score: number;
  matchedTags: string[];
  details: Record<string, string>;
}

const Stars = () => {
  const stars = useMemo(
    () => Array.from({ length: 60 }, () => ({
      top: Math.random() * 100,
      left: Math.random() * 100,
      size: Math.random() * 2 + 1,
      delay: Math.random() * 4,
      duration: Math.random() * 3 + 2,
    })),
    []
  );
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      {stars.map((s, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full bg-foreground"
          style={{ top: `${s.top}%`, left: `${s.left}%`, width: s.size, height: s.size }}
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ duration: s.duration, delay: s.delay, repeat: Infinity }}
        />
      ))}
    </div>
  );
};

const Index = () => {
  const [screen, setScreen] = useState<Screen>("landing");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [currentQ, setCurrentQ] = useState(0);
  // Single-select questions store a number; multi-select store an array of indices.
  const [answers, setAnswers] = useState<(number | number[] | null)[]>(
    () => questions.map((q) => (q.multiSelect ? [] as number[] : null))
  );
  const [results, setResults] = useState<Recommendation[]>([]);
  const [wantsSupply, setWantsSupply] = useState<null | boolean>(null);
  const [supplyNonce, setSupplyNonce] = useState<string | null>(null);
  const [wantsReport, setWantsReport] = useState<null | boolean>(null);

  useEffect(() => {
    document.title = "Crystal Reading Quiz — Find Your Soul-Aligned Crystals";
  }, []);

  const progress = ((currentQ + 1) / questions.length) * 100;

  const submit = async (finalAnswers: (number | number[] | null)[]) => {
    setScreen("loading");
    const payload = {
      name,
      email,
      answers: questions.map((q, i) => {
        const sel = finalAnswers[i];
        const indices: number[] = Array.isArray(sel)
          ? sel
          : sel != null ? [sel] : [];
        const opts = indices.map((idx) => q.options[idx]).filter(Boolean);
        return {
          questionIndex: i,
          optionIndex: Array.isArray(sel) ? (sel[0] ?? null) : sel,
          optionIndices: indices,
          questionText: q.text,
          optionText: opts.map((o) => o.text).join(" + "),
          tags: opts.flatMap((o) => o.tags) as Tag[],
        };
      }),
    };
    try {
      const { data, error } = await supabase.functions.invoke("crystal-quiz", { body: payload });
      if (error) throw error;
      setResults(data.recommendations || []);
      setSupplyNonce(data.nonce || null);
      setScreen("results");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      toast.error(msg);
      setScreen("quiz");
    }
  };

  const advance = (next: (number | number[] | null)[]) => {
    if (currentQ < questions.length - 1) {
      setTimeout(() => setCurrentQ(currentQ + 1), 350);
    } else {
      setTimeout(() => submit(next), 350);
    }
  };

  const selectOption = (idx: number) => {
    const q = questions[currentQ];
    const next = [...answers];

    if (q.multiSelect) {
      const max = q.maxSelections ?? 2;
      const current = Array.isArray(next[currentQ]) ? [...(next[currentQ] as number[])] : [];
      const at = current.indexOf(idx);
      if (at >= 0) {
        current.splice(at, 1);
      } else {
        if (current.length >= max) {
          toast(`You can choose up to ${max} options`);
          return;
        }
        current.push(idx);
      }
      next[currentQ] = current;
      setAnswers(next);
      // Don't auto-advance for multi-select; user clicks Continue
      return;
    }

    next[currentQ] = idx;
    setAnswers(next);
    advance(next);
  };

  const handleContinue = () => {
    const q = questions[currentQ];
    const sel = answers[currentQ];
    if (q.multiSelect) {
      if (!Array.isArray(sel) || sel.length === 0) {
        toast.error("Please select at least one option");
        return;
      }
    } else if (sel == null) {
      toast.error("Please select an option");
      return;
    }
    advance(answers);
  };

  const handleSupply = async (yes: boolean) => {
    setWantsSupply(yes);
    try {
      // best-effort secondary update via insert (small follow-up event)
      await supabase.functions.invoke("crystal-quiz", {
        body: { name, email, answers: [], _supplyOnly: true, wantsSupply: yes, nonce: supplyNonce },
      }).catch(() => {});
    } catch {}
    if (yes) toast.success("✨ Wonderful! We'll be in touch within 24h.");
    else toast("Thanks for taking the reading 💜");
  };

  const handleReport = async (yes: boolean) => {
    setWantsReport(yes);
    try {
      await supabase.functions.invoke("crystal-quiz", {
        body: { name, email, answers: [], _reportOnly: true, wantsReport: yes, nonce: supplyNonce },
      }).catch(() => {});
    } catch {}
    if (yes) toast.success("✨ Beautiful! Your personalised report will arrive within 48h.");
    else toast("Whenever you're ready 💫");
  };

  return (
    <main className="relative min-h-screen bg-[#fff5f6] text-[#fff5f6]" style={{ background: "var(--gradient-cosmic)" }}>
      <Stars />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-2xl flex-col px-5 py-8">
        <AnimatePresence mode="wait">
          {screen === "landing" && (
            <motion.section
              key="landing"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-1 flex-col items-center justify-center text-center"
            >
              <motion.div
                animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.05, 1] }}
                transition={{ duration: 6, repeat: Infinity }}
                className="mb-6 text-7xl"
                style={{ filter: "drop-shadow(0 0 30px hsl(var(--primary) / 0.6))" }}
              >
                🔮
              </motion.div>
              <h1 className="mb-4 text-4xl font-light tracking-tight md:text-6xl">
                <span className="bg-clip-text text-white font-semibold" style={{ backgroundImage: "var(--gradient-mystic)" }}>
                  Discover YOUR
                </span>
                <br />
                <span className="italic text-white font-bold">Soul Crystals!</span>
              </h1>
              <p className="mb-2 max-w-md text-base md:text-lg text-[#fff5f6]">
                The universe has a message for you.
              </p>
              <p className="mb-10 max-w-md text-sm text-[#fff5f6]">
                Answer 9 short questions and discover the crystals aligned with your energy <em>right now</em>. Personalised. Accurate. Under 2 minutes.
              </p>
              <Button
                size="lg"
                onClick={() => setScreen("capture")}
                className="rounded-full px-8 py-6 text-base font-medium shadow-[var(--shadow-glow)] hover:shadow-[var(--shadow-elegant)] transition-all hover:scale-105 bg-[#be1e28] text-[#fff5f6]"
                style={{ background: "#be1e28", color: "#fff5f6" }}
              >
                <Sparkles className="mr-2 h-5 w-5" /> Begin Your Reading
              </Button>
              <div className="mt-12 flex items-center gap-6 text-xs">
                <span className="flex items-center gap-1.5 font-semibold text-[#fff5f6]"><Moon className="h-3.5 w-3.5" /> Free reading</span>
                <span className="flex items-center gap-1.5 font-semibold text-[#fff5f6]"><Star className="h-3.5 w-3.5" /> 9 questions</span>
                <span className="flex items-center gap-1.5 font-semibold text-[#fff5f6]"><Gem className="h-3.5 w-3.5" /> 3 crystals</span>
              </div>
            </motion.section>
          )}

          {screen === "capture" && (
            <motion.section
              key="capture"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-1 flex-col items-center justify-center"
            >
              <div className="w-full max-w-md rounded-3xl border border-border p-8 backdrop-blur-sm" style={{ background: "var(--gradient-card)" }}>
                <div className="mb-6 text-center">
                  <Mail className="mx-auto mb-3 h-8 w-8 text-white" />
                  <h2 className="text-2xl font-light text-white">Where shall we send your reading?</h2>
                  <p className="mt-2 text-sm text-[#fff5f6]">
                    We'll save your crystals so you can revisit anytime ✨
                  </p>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!name.trim() || !email.trim()) {
                      toast.error("Please share your name and email");
                      return;
                    }
                    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                      toast.error("Please enter a valid email");
                      return;
                    }
                    setScreen("quiz");
                  }}
                  className="space-y-3"
                >
                  <Input
                    placeholder="Your first name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={60}
                    className="h-12 bg-background/40 border-white rounded-full"
                  />
                  <Input
                    type="email"
                    placeholder="you@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    maxLength={120}
                    className="h-12 bg-background/40 border-white rounded-full"
                  />
                  <Button type="submit" className="h-12 w-full text-base text-[#fff5f6] bg-[#be1e28] hover:bg-[#be1e28] rounded-full">
                    Start My Crystal Quiz <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </form>
                <p className="mt-4 text-center text-xs text-white">
                  🔒 Your details stay sacred. No spam, ever.
                </p>
              </div>
            </motion.section>
          )}

          {screen === "quiz" && (
            <motion.section
              key={`q-${currentQ}`}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              className="flex flex-1 flex-col"
            >
              <div className="mb-6">
                <div className="mb-2 flex items-center justify-between text-xs text-[#fff5f6]">
                  <span>Question {currentQ + 1} of {questions.length}</span>
                  <span className="text-white font-semibold">{Math.round(progress)}% aligned ✨</span>
                </div>
                <Progress value={progress} className="h-1.5 bg-muted" />
              </div>
              <h2 className="mb-6 text-2xl font-light leading-snug md:text-3xl text-white">
                {questions[currentQ].text}
              </h2>
              {questions[currentQ].multiSelect && (
                <p className="-mt-4 mb-5 text-xs italic text-white">
                  ✨ Choose up to {questions[currentQ].maxSelections ?? 2}
                </p>
              )}
              <div className="space-y-3">
                {questions[currentQ].options.map((opt, i) => {
                  const a = answers[currentQ];
                  const selected = Array.isArray(a) ? a.includes(i) : a === i;
                  const isMulti = !!questions[currentQ].multiSelect;
                  return (
                    <button
                      key={i}
                      onClick={() => selectOption(i)}
                      className={`group flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-all hover:scale-[1.01] hover:border-[#be1e28]/60 ${
                        selected ? "border-[#fff5f6] shadow-[var(--shadow-glow)]" : "border-border"
                      }`}
                      style={{
                        background: selected
                          ? "linear-gradient(135deg, #be1e2833, #be1e2811)"
                          : "var(--gradient-card)",
                      }}
                    >
                      <span className="text-2xl">{opt.icon}</span>
                      <span className="flex-1 text-sm md:text-base">{opt.text}</span>
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center border-2 ${
                          isMulti ? "rounded-md" : "rounded-full"
                        } ${selected ? "border-[#be1e28] bg-[#be1e28]" : "border-[#fff5f6]/40"}`}
                      >
                        {selected && isMulti && (
                          <Check className="h-3.5 w-3.5 text-[#fff5f6]" strokeWidth={3} />
                        )}
                        {selected && !isMulti && (
                          <span className="h-2 w-2 rounded-full bg-[#fff5f6]" />
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
              {questions[currentQ].multiSelect && (
                <Button
                  onClick={handleContinue}
                  disabled={!Array.isArray(answers[currentQ]) || (answers[currentQ] as number[]).length === 0}
                  className="mt-5 h-12 w-full rounded-xl text-base bg-[#be1e28] text-[#fff5f6] hover:bg-[#be1e28]/90"
                >
                  Continue <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              )}
              {questions[currentQ].skippable && (
                <button
                  onClick={() => {
                    const next = [...answers];
                    next[currentQ] = questions[currentQ].multiSelect ? [] : null;
                    setAnswers(next);
                    advance(next);
                  }}
                  className="mt-4 self-center text-xs text-[#fff5f6]/70 underline-offset-4 hover:text-white hover:underline"
                >
                  Skip this question
                </button>
              )}
              <div className="mt-6 flex justify-between">
                <Button
                  variant="ghost"
                  onClick={() => currentQ > 0 && setCurrentQ(currentQ - 1)}
                  disabled={currentQ === 0}
                  className="text-[#fff5f6] hover:text-white"
                >
                  <ArrowLeft className="mr-1 h-4 w-4" /> Back
                </Button>
                <span className="self-center text-xs text-[#fff5f6] italic">
                  {currentQ < 3 && "Trust your first instinct ✨"}
                  {currentQ >= 3 && currentQ < 6 && "You're doing beautifully 💫"}
                  {currentQ >= 6 && "Almost there, the crystals await 🔮"}
                </span>
              </div>
            </motion.section>
          )}

          {screen === "loading" && (
            <motion.section
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-1 flex-col items-center justify-center text-center"
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                className="mb-6 text-6xl"
              >
                🔮
              </motion.div>
              <h2 className="mb-2 text-2xl font-light text-white">Reading your energy…</h2>
              <p className="text-sm text-[#fff5f6]">Aligning your crystals with the universe</p>
            </motion.section>
          )}

          {screen === "results" && (
            <motion.section
              key="results"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-1 flex-col py-8"
            >
              <div className="mb-8 text-center">
                <motion.div
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="mb-3 text-5xl"
                >
                  ✨
                </motion.div>
                <h1 className="text-3xl font-light md:text-4xl text-white">
                  {name}, the universe has spoken
                </h1>
                <p className="mt-2 text-sm text-[#fff5f6]">
                  Your 3 soul-aligned crystals, in order of resonance
                </p>
              </div>

              {results.length === 0 && (
                <p className="text-center text-[#fff5f6]">
                  No matches found. Please try again.
                </p>
              )}

              <div className="space-y-4">
                {results.map((r, i) => (
                  <motion.article
                    key={r.name}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.2 }}
                    className="rounded-3xl border border-border p-6 backdrop-blur-sm"
                    style={{ background: "var(--gradient-card)", boxShadow: i === 0 ? "var(--shadow-glow)" : undefined }}
                  >
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <div className="mb-1 text-xs uppercase tracking-widest text-white font-semibold">
                          {i === 0 ? "✦ Your primary crystal" : i === 1 ? "✦ Your second crystal" : "✦ Your third crystal"}
                        </div>
                        <h3 className="text-2xl font-medium text-white">{r.name}</h3>
                      </div>
                      <div className="text-right text-xs text-[#fff5f6]">
                        <div className="text-2xl font-light text-white">{r.score}</div>
                        <div>resonance</div>
                      </div>
                    </div>
                    {r.details.Functions && (
                      <p className="mb-2 text-sm text-[#fff5f6]">
                        <span className="text-[#fff5f6]/70">Supports: </span>
                        {r.details.Functions}
                      </p>
                    )}
                    {(r.details.Chakra || r.details.Element || r.details.Color || r.details.Colour) && (
                      <div className="flex flex-wrap gap-2 text-xs">
                        {r.details.Chakra && <span className="rounded-full bg-[#be1e28] text-[#fff5f6] px-3 py-1">{r.details.Chakra} chakra</span>}
                        {r.details.Element && <span className="rounded-full bg-[#be1e28] text-[#fff5f6] px-3 py-1">{r.details.Element}</span>}
                        {(r.details.Color || r.details.Colour) && (
                          <span className="rounded-full bg-[#be1e28] text-[#fff5f6] px-3 py-1">{r.details.Color || r.details.Colour}</span>
                        )}
                      </div>
                    )}
                  </motion.article>
                ))}
              </div>

              {/* Supply hook */}
              {results.length > 0 && wantsSupply === null && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.8 }}
                  className="mt-8 rounded-3xl border-2 border-[#be1e28]/50 p-6 text-center"
                  style={{ background: "linear-gradient(135deg, hsl(var(--accent) / 0.15), hsl(var(--primary) / 0.1))" }}
                >
                  <Heart className="mx-auto mb-2 h-6 w-6 text-white" />
                  <h3 className="mb-2 text-xl font-light text-white">
                    Want us to send these crystals to you?
                  </h3>
                  <p className="mb-4 text-sm text-[#fff5f6]">
                    Hand-picked, ethically sourced, charged under a full moon 🌕
                    <br />Delivered to your door so you can start your journey today.
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                    <Button
                      onClick={() => handleSupply(true)}
                      className="rounded-full px-6 bg-[#be1e28] text-[#fff5f6] hover:bg-[#be1e28]/90"
                    >
                      ✨ Yes, send my crystals
                    </Button>
                    <Button variant="ghost" onClick={() => handleSupply(false)} className="rounded-full text-[#fff5f6] hover:text-white">
                      Maybe later
                    </Button>
                  </div>
                </motion.div>
              )}

              {wantsSupply !== null && (
                <p className="mt-8 text-center text-sm text-[#fff5f6]">
                  {wantsSupply ? "💜 We'll reach out within 24 hours." : "💫 Save this page — your crystals await whenever you're ready."}
                </p>
              )}

              {results.length > 0 && wantsReport === null && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 1 }}
                  className="mt-6 rounded-3xl border-2 border-[#be1e28]/50 p-6 text-center"
                  style={{ background: "linear-gradient(135deg, hsl(var(--primary) / 0.15), hsl(var(--accent) / 0.1))" }}
                >
                  <Sparkles className="mx-auto mb-2 h-6 w-6 text-white" />
                  <h3 className="mb-2 text-xl font-light text-white">
                    Want a personalised healing crystal recommendation specific to your birth chart?
                  </h3>
                  <p className="mb-4 text-sm text-[#fff5f6]">
                    Personalized to your own birth chart, hand written PDF report delivered within 48 hours straight to your inbox!
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                    <Button
                      asChild
                      onClick={() => handleReport(true)}
                      className="rounded-full px-6 bg-[#be1e28] text-[#fff5f6] hover:bg-[#be1e28]/90"
                    >
                      <a
                        href="https://jayakamala.com/crystal-healing-consultation"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        ✨ Yes, send me a personalised report
                      </a>
                    </Button>
                    <Button variant="ghost" className="rounded-full text-[#fff5f6] hover:text-white" onClick={() => handleReport(false)}>
                      Maybe later
                    </Button>
                  </div>
                </motion.div>
              )}

              {wantsReport !== null && (
                <p className="mt-6 text-center text-sm text-[#fff5f6]">
                  {wantsReport ? "💜 Your personalised birth-chart report is on its way (within 48h)." : "💫 The personalised report is here whenever you're ready."}
                </p>
              )}
            </motion.section>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
};

export default Index;
