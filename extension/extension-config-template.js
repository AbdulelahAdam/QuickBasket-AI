const EXT_CONFIG = {
  SUPABASE_URL: "%%SUPABASE_URL%%",
  SUPABASE_ANON_KEY: "%%SUPABASE_ANON_KEY%%",
  API_BASE_URL: "%%API_BASE_URL%%",
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = EXT_CONFIG;
}
