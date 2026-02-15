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
    // Verify the user is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("[get-realtime-token] No Authorization header present");
      return new Response(JSON.stringify({ error: "Missing authorization header", debug: "no_auth_header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const hasOpenAIKey = !!Deno.env.get("OPENAI_API_KEY");

    console.log(`[get-realtime-token] Auth header length: ${authHeader.length}, starts: ${authHeader.substring(0, 15)}...`);
    console.log(`[get-realtime-token] SUPABASE_URL set: ${!!supabaseUrl} (${supabaseUrl.substring(0, 30)}...), ANON_KEY set: ${!!supabaseAnonKey} (len=${supabaseAnonKey.length}), OPENAI_KEY set: ${hasOpenAIKey}`);

    const supabase = createClient(
      supabaseUrl,
      supabaseAnonKey,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.error(`[get-realtime-token] Auth FAILED — error: ${authError?.message || 'no error obj'}, status: ${authError?.status || 'n/a'}, user null: ${!user}`);
      return new Response(JSON.stringify({
        error: "Unauthorized",
        debug: {
          authErrorMessage: authError?.message || null,
          authErrorStatus: authError?.status || null,
          userNull: !user,
          supabaseUrlSet: !!supabaseUrl,
          anonKeySet: !!supabaseAnonKey,
        }
      }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[get-realtime-token] Auth OK — user: ${user.id}, email: ${user.email}`);

    // Check subscription tier — enforce server-side limits
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("subscription_tier, trial_start_date")
      .eq("id", user.id)
      .single();

    if (profileError) {
      console.warn(`[get-realtime-token] Profile fetch error: ${profileError.message} (code: ${profileError.code})`);
    }
    const tier = profile?.subscription_tier || "free";
    console.log(`[get-realtime-token] Tier: ${tier}, profile found: ${!!profile}`);

    // Check trial expiry
    if (tier === "trial" && profile?.trial_start_date) {
      const trialStart = new Date(profile.trial_start_date).getTime();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      if (Date.now() - trialStart > sevenDays) {
        return new Response(JSON.stringify({ error: "Trial expired. Upgrade to Pro for continued access." }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Free tier: still allowed (limited on client side to 2 observations),
    // but we log it for monitoring. Pro/trial get full access.

    // Parse request body for session config
    const body = await req.json().catch(() => ({}));
    const instructions = body.instructions || "";
    const voice = body.voice || "ash";

    // Get ephemeral token from OpenAI
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: "OpenAI API key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tokenResponse = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: "gpt-realtime",
          voice: voice,
          instructions: instructions,
          modalities: ["text", "audio"],
          input_audio_transcription: { model: "whisper-1" },
        }
      }),
    });

    console.log(`[get-realtime-token] OpenAI response status: ${tokenResponse.status}`);
    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error(`[get-realtime-token] OpenAI token error (${tokenResponse.status}):`, errText);
      return new Response(JSON.stringify({ error: "Failed to get OpenAI token", debug: { openaiStatus: tokenResponse.status, openaiError: errText.substring(0, 200) } }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tokenData = await tokenResponse.json();

    return new Response(JSON.stringify({
      ephemeralKey: tokenData.value,
      expiresAt: tokenData.expires_at,
      tier: tier,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("get-realtime-token error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
