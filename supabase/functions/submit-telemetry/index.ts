import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "https://acecoach.ai";

const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify the caller is authenticated (prevents spam) but do NOT store identity
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    // Verify auth token is valid (user exists)
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse anonymized telemetry payload
    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.entries) || body.entries.length === 0) {
      return new Response(JSON.stringify({ error: "Invalid payload: expected { entries: [...] }" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate and sanitize entries — strip any PII
    const rows = [];
    for (const entry of body.entries.slice(0, 10)) { // Cap at 10 entries per request
      if (!entry.strokeType || typeof entry.strokeCount !== "number") continue;

      rows.push({
        skill_level: sanitizeText(entry.skillLevel, "intermediate"),
        ntrp_level: sanitizeText(entry.ntrpLevel, null),
        session_number: typeof entry.sessionNumber === "number" ? entry.sessionNumber : null,
        stroke_type: sanitizeText(entry.strokeType, "unknown"),
        stroke_count: Math.max(0, Math.min(entry.strokeCount, 9999)),
        avg_quality: clamp(entry.avgQuality, 0, 100),
        avg_form_score: clamp(entry.avgFormScore, 0, 100),
        metrics: sanitizeMetrics(entry.metrics),
        fault_frequencies: sanitizeFaults(entry.faultFrequencies),
        session_duration_minutes: clamp(entry.sessionDurationMinutes, 0, 600),
        telemetry_version: entry.telemetryVersion || 1,
      });
    }

    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: "No valid entries" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert with service role (bypasses RLS — table has no RLS)
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const { error: insertError } = await serviceClient
      .from("anonymous_telemetry")
      .insert(rows);

    if (insertError) {
      console.error("submit-telemetry insert error:", insertError);
      return new Response(JSON.stringify({ error: "Insert failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ inserted: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("submit-telemetry error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// --- Helpers ---

function sanitizeText(val: unknown, fallback: string | null): string | null {
  if (typeof val !== "string") return fallback;
  return val.slice(0, 50); // Cap length
}

function clamp(val: unknown, min: number, max: number): number | null {
  if (typeof val !== "number" || isNaN(val)) return null;
  return Math.max(min, Math.min(val, max));
}

function sanitizeMetrics(metrics: unknown): Record<string, unknown> {
  if (!metrics || typeof metrics !== "object") return {};
  const safe: Record<string, unknown> = {};
  const allowed = ["rotation", "hipSep", "elbowAngle", "smoothness", "velocity", "acceleration"];
  for (const key of allowed) {
    const val = (metrics as Record<string, unknown>)[key];
    if (val && typeof val === "object") {
      // Expect { avg, p25, p50, p75 }
      const m = val as Record<string, unknown>;
      safe[key] = {
        avg: clamp(m.avg, -9999, 9999),
        p25: clamp(m.p25, -9999, 9999),
        p50: clamp(m.p50, -9999, 9999),
        p75: clamp(m.p75, -9999, 9999),
      };
    }
  }
  return safe;
}

function sanitizeFaults(faults: unknown): Record<string, number> {
  if (!faults || typeof faults !== "object") return {};
  const safe: Record<string, number> = {};
  for (const [key, val] of Object.entries(faults as Record<string, unknown>)) {
    if (typeof val === "number" && key.length <= 50) {
      safe[key.slice(0, 50)] = Math.max(0, Math.min(val, 1)); // ratio 0-1
    }
  }
  return safe;
}
