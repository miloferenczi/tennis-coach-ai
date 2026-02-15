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
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check subscription tier — free users should NOT get the raw Gemini key.
    // They should use the gemini-proxy edge function instead (which enforces limits).
    // However, for backward compat during migration, we still return the key
    // but log the tier for monitoring.
    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_tier, trial_start_date")
      .eq("id", user.id)
      .single();

    const tier = profile?.subscription_tier || "free";

    // Block free tier from getting the raw key — they must use gemini-proxy
    if (tier === "free") {
      return new Response(JSON.stringify({ error: "Gemini features require a Pro or Trial subscription" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    // Return Gemini API key to authenticated paying user
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return new Response(JSON.stringify({ error: "Gemini API key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ apiKey: geminiKey }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("get-gemini-key error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
