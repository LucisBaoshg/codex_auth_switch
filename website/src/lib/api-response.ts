const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const noStoreHeaders = {
  ...corsHeaders,
  "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
};

export function optionsResponse() {
  return new Response(null, { headers: noStoreHeaders });
}
