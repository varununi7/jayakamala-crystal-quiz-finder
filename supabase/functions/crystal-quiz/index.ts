import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------- Input sanitization & validation ----------

// Prevent Google Sheets formula injection. Any cell value beginning with
// =, +, -, or @ is treated as a formula by Sheets — prefix with a single
// quote so it renders as plain text. Belt-and-braces alongside RAW input mode.
function sanitizeCell(value: string | number): string {
  const s = String(value ?? "");
  if (/^[=+\-@]/.test(s)) return `'${s}`;
  return s;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validateLead(name: unknown, email: unknown): { ok: true; name: string; email: string } | { ok: false; error: string } {
  if (typeof name !== "string" || typeof email !== "string") return { ok: false, error: "Invalid name or email" };
  const n = name.trim();
  const e = email.trim();
  if (n.length === 0 || n.length > 100) return { ok: false, error: "Name must be 1-100 characters" };
  if (e.length === 0 || e.length > 254 || !EMAIL_RE.test(e)) return { ok: false, error: "Invalid email" };
  return { ok: true, name: n, email: e };
}

// ---------- In-memory per-IP rate limiter ----------
// Lightweight protection against bulk lead spam. Resets when the worker recycles.
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(ip: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}
function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] || req.headers.get("cf-connecting-ip") || "unknown").trim();
}

// ---------- Short-lived nonce store ----------
// On a successful quiz submission we mint a nonce bound to the email.
// Only that nonce can later flip the "Wants Crystals" cell for that email,
// preventing arbitrary callers from overwriting other people's rows.
interface NonceEntry { email: string; expiresAt: number }
const nonces = new Map<string, NonceEntry>();
const NONCE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function mintNonce(email: string): string {
  // Drop expired nonces opportunistically
  const now = Date.now();
  if (nonces.size > 1000) {
    for (const [k, v] of nonces) if (v.expiresAt < now) nonces.delete(k);
  }
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  const nonce = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  nonces.set(nonce, { email: email.toLowerCase(), expiresAt: now + NONCE_TTL_MS });
  return nonce;
}
function consumeNonce(nonce: string, email: string): boolean {
  const entry = nonces.get(nonce);
  if (!entry) return false;
  nonces.delete(nonce); // single-use
  if (entry.expiresAt < Date.now()) return false;
  return entry.email === email.toLowerCase();
}

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

// ---------- Google Service Account JWT + Sheets append ----------

let tokenCache: { token: string; exp: number } | null = null;

function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : new Uint8Array(input);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.exp - 60 > Math.floor(Date.now() / 1000)) {
    return tokenCache.token;
  }
  const raw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON");
  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const header = { alg: "RS256", typ: "JWT" };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const keyData = pemToPkcs8(sa.private_key);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${base64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Google token exchange failed [${res.status}]: ${t}`);
  }
  const json = await res.json();
  tokenCache = { token: json.access_token, exp: now + (json.expires_in || 3600) };
  return tokenCache.token;
}

async function appendLeadToSheet(row: (string | number)[]): Promise<void> {
  const sheetId = Deno.env.get("LEADS_SHEET_ID");
  const tab = Deno.env.get("LEADS_SHEET_TAB") || "Leads";
  if (!sheetId) throw new Error("Missing LEADS_SHEET_ID");
  const token = await getAccessToken();
  const range = `${tab}!A:Z`;
  // RAW disables formula parsing. Combined with sanitizeCell this is defense-in-depth.
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const safeRow = row.map(sanitizeCell);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: [safeRow] }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Sheets append failed [${res.status}]: ${t}`);
  }
}

// Update the "Wants Crystals" column (E) for the most recent row matching this email.
async function updateWantsSupplyInSheet(email: string, wantsSupply: boolean): Promise<void> {
  const sheetId = Deno.env.get("LEADS_SHEET_ID");
  const tab = Deno.env.get("LEADS_SHEET_TAB") || "Leads";
  if (!sheetId) throw new Error("Missing LEADS_SHEET_ID");
  const token = await getAccessToken();

  // Read column C (email) to find the row
  const readRange = `${tab}!A:E`;
  const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(readRange)}`;
  const readRes = await fetch(readUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!readRes.ok) {
    throw new Error(`Sheets read failed [${readRes.status}]: ${await readRes.text()}`);
  }
  const data = await readRes.json();
  const rows: string[][] = data.values || [];
  const target = email.toLowerCase().trim();
  let rowIndex = -1;
  // Iterate from bottom up to grab the latest entry
  for (let i = rows.length - 1; i >= 1; i--) {
    const cell = (rows[i]?.[2] || "").toLowerCase().trim();
    if (cell === target) { rowIndex = i; break; }
  }
  if (rowIndex === -1) {
    console.warn(`No matching row found for email ${email}`);
    return;
  }
  const sheetRow = rowIndex + 1; // 1-indexed
  const writeRange = `${tab}!E${sheetRow}`;
  const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(writeRange)}?valueInputOption=RAW`;
  const writeRes = await fetch(writeUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: [[sanitizeCell(wantsSupply ? "Yes" : "Maybe later")]] }),
  });
  if (!writeRes.ok) {
    throw new Error(`Sheets update failed [${writeRes.status}]: ${await writeRes.text()}`);
  }
}

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
    const ip = clientIp(req);

    if (action === "list") {
      // Light rate limit on the public crystal listing
      if (!rateLimit(`list:${ip}`, 30, 60_000)) {
        return new Response(JSON.stringify({ error: "Too many requests" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const crystals = await fetchCrystals();
      return new Response(JSON.stringify({ crystals }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // submit
    const body: QuizSubmission & { _supplyOnly?: boolean; wantsSupply?: boolean; nonce?: string } = await req.json();

    // Handle the supply follow-up event (after results are shown)
    if (body._supplyOnly && body.email) {
      // Rate limit follow-up writes
      if (!rateLimit(`supply:${ip}`, 10, 60_000)) {
        return new Response(JSON.stringify({ error: "Too many requests" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Require a valid, single-use, email-bound nonce so callers cannot
      // overwrite arbitrary emails' "Wants Crystals" column.
      if (typeof body.nonce !== "string" || !consumeNonce(body.nonce, body.email)) {
        return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const v = validateLead("placeholder", body.email);
      if (!v.ok) {
        return new Response(JSON.stringify({ error: "Invalid email" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      try {
        await updateWantsSupplyInSheet(v.email, !!body.wantsSupply);
      } catch (err) {
        console.error("Supply update failed:", err instanceof Error ? err.message : err);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate limit submissions
    if (!rateLimit(`submit:${ip}`, 5, 60_000)) {
      return new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const v = validateLead(body.name, body.email);
    if (!v.ok || !Array.isArray(body.answers) || body.answers.length > 50) {
      return new Response(JSON.stringify({ error: "Invalid submission" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const safeName = v.name;
    const safeEmail = v.email;

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
      name: safeName,
      email: safeEmail,
      answers: body.answers,
      recommendations: top3,
    });

    // Append to Google Sheet (best-effort: don't fail the request if it errors)
    try {
      const topNames = top3.map((t) => t.name).join(", ");
      await appendLeadToSheet([
        new Date().toISOString(),
        safeName,
        safeEmail,
        topNames,
        "", // Wants Crystals — filled in after the user answers the supply question
      ]);
    } catch (sheetErr) {
      console.error("Sheet append failed:", sheetErr instanceof Error ? sheetErr.message : sheetErr);
    }

    // Mint a single-use, email-bound nonce so the client can later record the
    // user's "Wants Crystals" choice for THIS email only.
    const nonce = mintNonce(safeEmail);

    return new Response(JSON.stringify({ recommendations: top3, nonce }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Log full detail server-side; return generic message to clients to avoid
    // leaking Sheet IDs, OAuth bodies, or env-var names in error responses.
    console.error("crystal-quiz error:", msg);
    return new Response(JSON.stringify({ error: "An internal error occurred. Please try again." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
