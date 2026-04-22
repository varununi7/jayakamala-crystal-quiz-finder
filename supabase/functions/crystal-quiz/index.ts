import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Crystal {
  name: string;
  functions: string;
  collections: string;
  chakra: string;
  color: string;
  element: string;
  raw: Record<string, string>;
}

interface Tag {
  field: "functions" | "collections" | "chakra" | "color" | "element";
  value: string;
  weight: number;
}

interface QuizSubmission {
  name: string;
  email: string;
  // each answer: { questionIndex, optionIndex, tags: Tag[], questionText, optionText }
  answers: Array<{
    questionIndex: number;
    optionIndex: number;
    questionText: string;
    optionText: string;
    tags: Tag[];
  }>;
}

let crystalCache: { data: Crystal[]; ts: number } | null = null;
const CACHE_MS = 5 * 60 * 1000;

async function fetchCrystals(): Promise<Crystal[]> {
  if (crystalCache && Date.now() - crystalCache.ts < CACHE_MS) {
    return crystalCache.data;
  }
  const apiKey = Deno.env.get("GOOGLE_SHEETS_API_KEY");
  const sheetId = Deno.env.get("GOOGLE_SHEETS_ID");
  if (!apiKey || !sheetId) throw new Error("Missing Google Sheets credentials");

  // Fetch first sheet, all values
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:Z1000?key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Sheets API failed [${res.status}]: ${txt}`);
  }
  const json = await res.json();
  const rows: string[][] = json.values || [];
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  const findCol = (re: RegExp) => headers.findIndex((h) => re.test(h));
  const nameCol = findCol(/name|crystal/i);
  const fnCol = findCol(/function/i);
  const colCol = findCol(/collection/i);
  const chCol = findCol(/chakra/i);
  const colorCol = findCol(/colou?r/i);
  const elCol = findCol(/element/i);

  const crystals: Crystal[] = rows.slice(1)
    .filter((r) => r[nameCol]?.trim())
    .map((r) => {
      const raw: Record<string, string> = {};
      headers.forEach((h, i) => (raw[h] = r[i] || ""));
      return {
        name: r[nameCol]?.trim() || "",
        functions: r[fnCol] || "",
        collections: r[colCol] || "",
        chakra: r[chCol] || "",
        color: r[colorCol] || "",
        element: r[elCol] || "",
        raw,
      };
    });

  crystalCache = { data: crystals, ts: Date.now() };
  return crystals;
}

function tokenMatch(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase().trim();
  if (!n) return false;
  // match whole-word-ish: substring suffices for tags
  return h.includes(n);
}

function scoreCrystals(crystals: Crystal[], tags: Tag[]) {
  return crystals.map((c) => {
    let score = 0;
    const matchedTags: string[] = [];
    for (const t of tags) {
      const field = c[t.field];
      if (tokenMatch(field, t.value)) {
        score += t.weight;
        matchedTags.push(`${t.field}:${t.value}`);
      }
    }
    return { crystal: c, score, matchedTags };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "submit";

    if (action === "list") {
      const crystals = await fetchCrystals();
      return new Response(JSON.stringify({ crystals }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // submit
    const body: QuizSubmission = await req.json();
    if (!body.email || !body.name || !Array.isArray(body.answers)) {
      return new Response(JSON.stringify({ error: "Invalid submission" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const crystals = await fetchCrystals();
    const allTags = body.answers.flatMap((a) => a.tags);
    const scored = scoreCrystals(crystals, allTags)
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    const top3 = scored.slice(0, 3).map((s) => ({
      name: s.crystal.name,
      score: s.score,
      matchedTags: s.matchedTags,
      details: s.crystal.raw,
    }));

    // Save lead
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    await supabase.from("crystal_leads").insert({
      name: body.name,
      email: body.email,
      answers: body.answers,
      recommendations: top3,
    });

    return new Response(JSON.stringify({ recommendations: top3 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("crystal-quiz error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
