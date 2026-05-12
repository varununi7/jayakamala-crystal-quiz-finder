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

// ---------- Per-answer payload validation ----------
const MAX_ANSWERS = 50;
const MAX_TEXT = 500;
const MAX_TAGS_PER_ANSWER = 20;
const MAX_TAG_VALUE = 100;
const ALLOWED_TAG_FIELDS = new Set(["functions", "collections", "chakra", "color", "element"]);

function validateAnswers(input: unknown): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "answers must be an array" };
  if (input.length === 0 || input.length > MAX_ANSWERS) {
    return { ok: false, error: `answers must contain 1-${MAX_ANSWERS} items` };
  }
  for (let i = 0; i < input.length; i++) {
    const a = input[i] as Record<string, unknown> | null;
    if (!a || typeof a !== "object") return { ok: false, error: `answers[${i}] invalid` };
    if (!Number.isInteger(a.questionIndex) || (a.questionIndex as number) < 0 || (a.questionIndex as number) > 1000) {
      return { ok: false, error: `answers[${i}].questionIndex invalid` };
    }
    if (!Number.isInteger(a.optionIndex) || (a.optionIndex as number) < 0 || (a.optionIndex as number) > 1000) {
      return { ok: false, error: `answers[${i}].optionIndex invalid` };
    }
    if (typeof a.questionText !== "string" || a.questionText.length > MAX_TEXT) {
      return { ok: false, error: `answers[${i}].questionText invalid` };
    }
    if (typeof a.optionText !== "string" || a.optionText.length > MAX_TEXT) {
      return { ok: false, error: `answers[${i}].optionText invalid` };
    }
    const tags = a.tags as unknown[];
    if (!Array.isArray(tags) || tags.length > MAX_TAGS_PER_ANSWER) {
      return { ok: false, error: `answers[${i}].tags invalid` };
    }
    for (let j = 0; j < tags.length; j++) {
      const t = tags[j] as Record<string, unknown> | null;
      if (!t || typeof t !== "object") return { ok: false, error: `answers[${i}].tags[${j}] invalid` };
      if (typeof t.field !== "string" || !ALLOWED_TAG_FIELDS.has(t.field)) {
        return { ok: false, error: `answers[${i}].tags[${j}].field invalid` };
      }
      if (typeof t.value !== "string" || t.value.length === 0 || t.value.length > MAX_TAG_VALUE) {
        return { ok: false, error: `answers[${i}].tags[${j}].value invalid` };
      }
      if (typeof t.weight !== "number" || !Number.isFinite(t.weight) || t.weight < 0 || t.weight > 100) {
        return { ok: false, error: `answers[${i}].tags[${j}].weight invalid` };
      }
    }
  }
  return { ok: true };
}

// ---------- Shared, DB-backed per-IP rate limiter ----------
// Counters live in public.rate_limits so they are shared across edge worker
// instances and survive worker recycles. On DB error we fail-open and log.
async function rateLimit(
  supabaseAdmin: ReturnType<typeof createClient>,
  bucketKey: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin.rpc("rate_limit_hit", {
      _bucket_key: bucketKey,
      _limit: limit,
      _window_seconds: windowSeconds,
    });
    if (error) {
      console.error("rate_limit_hit error:", error.message);
      return true;
    }
    return data === true;
  } catch (err) {
    console.error("rate_limit_hit threw:", err instanceof Error ? err.message : err);
    return true;
  }
}
function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] || req.headers.get("cf-connecting-ip") || "unknown").trim();
}

// ---------- Stateless signed nonce ----------
// Edge function instances are ephemeral, so we cannot rely on in-memory state
// across calls. We mint an HMAC-signed token binding email + expiry. Any caller
// holding the token can record follow-up fields for that specific email only,
// which preserves the original security goal (no overwriting other people's rows).
const NONCE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const NONCE_SECRET = Deno.env.get("SUPABASE_JWKS") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "fallback-dev-secret";

async function hmacHex(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(NONCE_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function mintNonce(email: string): Promise<string> {
  const exp = Date.now() + NONCE_TTL_MS;
  const payload = `${email.toLowerCase()}|${exp}`;
  const sig = await hmacHex(payload);
  // base64url-encode payload to keep transport-safe; sig is hex
  const payloadB64 = btoa(payload).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${payloadB64}.${sig}`;
}

async function consumeNonce(nonce: string, email: string, _field: "supply" | "report"): Promise<boolean> {
  if (typeof nonce !== "string" || !nonce.includes(".")) return false;
  const [payloadB64, sig] = nonce.split(".");
  if (!payloadB64 || !sig) return false;
  let payload: string;
  try {
    payload = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));
  } catch { return false; }
  const [tokEmail, expStr] = payload.split("|");
  if (!tokEmail || !expStr) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  if (tokEmail !== email.toLowerCase()) return false;
  const expected = await hmacHex(payload);
  if (expected.length !== sig.length) return false;
  // constant-time-ish compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
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

// Update a single column (e.g. "E" Wants Crystals, "F" Wants Personalised Report)
// for the most recent row matching this email.
async function updateLeadColumnInSheet(email: string, column: "E" | "F", value: string): Promise<void> {
  const sheetId = Deno.env.get("LEADS_SHEET_ID");
  const tab = Deno.env.get("LEADS_SHEET_TAB") || "Leads";
  if (!sheetId) throw new Error("Missing LEADS_SHEET_ID");
  const token = await getAccessToken();

  // Read columns A:F to locate the most recent row for this email
  const readRange = `${tab}!A:F`;
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
  const writeRange = `${tab}!${column}${sheetRow}`;
  const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(writeRange)}?valueInputOption=RAW`;
  const writeRes = await fetch(writeUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: [[sanitizeCell(value)]] }),
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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (action === "list") {
      // Light rate limit on the public crystal listing
      if (!(await rateLimit(supabase, `list:${ip}`, 30, 60))) {
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
    const body: QuizSubmission & {
      _supplyOnly?: boolean;
      _reportOnly?: boolean;
      wantsSupply?: boolean;
      wantsReport?: boolean;
      nonce?: string;
    } = await req.json();

    // Handle the supply follow-up event (after results are shown)
    if (body._supplyOnly && body.email) {
      // Rate limit follow-up writes
      if (!(await rateLimit(supabase, `supply:${ip}`, 10, 60))) {
        return new Response(JSON.stringify({ error: "Too many requests" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Require a valid, email-bound nonce so callers cannot overwrite
      // arbitrary emails' "Wants Crystals" column.
      if (typeof body.nonce !== "string" || !(await consumeNonce(body.nonce, body.email, "supply"))) {
        return new Response(JSON.stringify({ ok: false, stale: true }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const v = validateLead("placeholder", body.email);
      if (!v.ok) {
        return new Response(JSON.stringify({ error: "Invalid email" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      try {
        await updateLeadColumnInSheet(v.email, "E", body.wantsSupply ? "Yes" : "Maybe later");
      } catch (err) {
        console.error("Supply update failed:", err instanceof Error ? err.message : err);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle the personalised-report follow-up event
    if (body._reportOnly && body.email) {
      if (!(await rateLimit(supabase, `report:${ip}`, 10, 60))) {
        return new Response(JSON.stringify({ error: "Too many requests" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (typeof body.nonce !== "string" || !(await consumeNonce(body.nonce, body.email, "report"))) {
        return new Response(JSON.stringify({ ok: false, stale: true }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const v = validateLead("placeholder", body.email);
      if (!v.ok) {
        return new Response(JSON.stringify({ error: "Invalid email" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      try {
        await updateLeadColumnInSheet(v.email, "F", body.wantsReport ? "Yes" : "Maybe later");
      } catch (err) {
        console.error("Report update failed:", err instanceof Error ? err.message : err);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rate limit submissions
    if (!(await rateLimit(supabase, `submit:${ip}`, 5, 60))) {
      return new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const v = validateLead(body.name, body.email);
    if (!v.ok) {
      return new Response(JSON.stringify({ error: "Invalid submission" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const answersCheck = validateAnswers(body.answers);
    if (!answersCheck.ok) {
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
        "", // Wants Personalised Report — filled in after the user answers the report prompt
      ]);
    } catch (sheetErr) {
      console.error("Sheet append failed:", sheetErr instanceof Error ? sheetErr.message : sheetErr);
    }

    // Mint a single-use, email-bound nonce so the client can later record the
    // user's "Wants Crystals" choice for THIS email only.
    const nonce = await mintNonce(safeEmail);

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
