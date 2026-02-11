import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Get client IP for rate limiting
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      "unknown";

    // Service role client to bypass RLS on guest_trials
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Rate limit: 2 guest tokens per IP per 24h (1 meet-coach + 1 trial)
    const twentyFourHoursAgo = new Date(
      Date.now() - 24 * 60 * 60 * 1000
    ).toISOString();

    const { data: recentTrials } = await supabase
      .from("guest_trials")
      .select("id, created_at")
      .eq("ip_address", clientIp)
      .gte("created_at", twentyFourHoursAgo);

    if (recentTrials && recentTrials.length >= 2) {
      return new Response(
        JSON.stringify({
          error: "Trial limit reached. Sign up for unlimited access!",
          retryAfter: 24 * 60 * 60,
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Record this trial attempt
    const { data: trial } = await supabase
      .from("guest_trials")
      .insert({ ip_address: clientIp })
      .select("id")
      .single();

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const instructions = body.instructions || "";
    const voice = body.voice || "alloy";

    // Get ephemeral token from OpenAI
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OpenAI API key not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const tokenResponse = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-realtime-preview",
          voice: voice,
          instructions: instructions,
          input_audio_transcription: { model: "whisper-1" },
        }),
      }
    );

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error("OpenAI token error:", errText);
      return new Response(
        JSON.stringify({ error: "Failed to get trial token" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const tokenData = await tokenResponse.json();

    return new Response(
      JSON.stringify({
        ephemeralKey: tokenData.client_secret?.value,
        expiresAt: tokenData.client_secret?.expires_at,
        trialId: trial?.id,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("get-guest-token error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
