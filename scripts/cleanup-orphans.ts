import { createClient } from '@supabase/supabase-js';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("Fetching auth users...");
  let allUsers = [];
  const perPage = 1000;
  
  // Supabase limits listUsers to 1000 at a time, but usually we just fetch the first page for this scale.
  const { data: { users }, error: authError } = await supabase.auth.admin.listUsers({ perPage });
  if (authError) {
    console.error("Auth Error:", authError);
    return;
  }
  allUsers = users;
  console.log(`Found ${allUsers.length} total users in auth.`);

  const { data: profiles, error: profError } = await supabase.from('profiles').select('id');
  if (profError) {
    console.error("Profiles Error:", profError);
    return;
  }
  
  const profileIds = new Set(profiles.map(p => p.id));
  console.log(`Found ${profileIds.size} total profiles.`);

  let deleted = 0;
  for (const user of allUsers) {
    if (!profileIds.has(user.id)) {
      console.log(`Deleting orphaned user: ${user.email} (${user.id})`);
      const { error } = await supabase.auth.admin.deleteUser(user.id);
      if (error) {
        console.error(`Failed to delete ${user.email}:`, error);
      } else {
        deleted++;
      }
    }
  }

  console.log(`Done! Deleted ${deleted} orphaned users.`);
}

run();
