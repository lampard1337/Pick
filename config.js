// Supabase-Verbindung für den gemeinsamen Sync.
// Werte findest du in Supabase unter: Project Settings → API Keys (bzw. "Data API" für die URL).
// Der Publishable/anon Key darf öffentlich sein – geschützt wird über Login + Row Level Security.
// Leer lassen = App läuft ohne Sync, nur lokal auf dem Handy.
window.HUNGER_CONFIG = {
  supabaseUrl: 'https://qvffkubuztbmoclpvuym.supabase.co',
  supabaseKey: 'sb_publishable_OmLaZc2FHgnFKuhkWaNBnA_50yjEzJS'
};
