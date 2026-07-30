const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const supabaseUrl = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const supabaseKey = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim();

const supabase = createClient(supabaseUrl, supabaseKey);

async function setup() {
  // Create a public bucket called 'app-config'
  const { data: bucket, error: bucketError } = await supabase.storage.createBucket('app-config', {
    public: true,
    allowedMimeTypes: ['application/json']
  });
  
  if (bucketError && bucketError.message !== 'The resource already exists') {
    console.error('Error creating bucket:', bucketError);
  } else {
    console.log('Bucket ready.');
  }

  // Upload config file
  const configContent = JSON.stringify({
    webUrl: "https://smart-dream-admin.vercel.app",
    latestVersion: "1.0.0",
    forceUpdate: true,
    downloadUrl: "https://github.com/nurulhudda247/SmartDream-Releases/releases/latest/download/SmartDream.apk",
    releaseNotes: "A new version of the app is available. Please update to continue."
  }, null, 2);

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('app-config')
    .upload('config.json', configContent, {
      contentType: 'application/json',
      upsert: true
    });

  if (uploadError) {
    console.error('Error uploading config:', uploadError);
  } else {
    console.log('Config uploaded!', uploadData);
    const { data: publicUrlData } = supabase.storage.from('app-config').getPublicUrl('config.json');
    console.log('Public URL:', publicUrlData.publicUrl);
  }
}

setup();
