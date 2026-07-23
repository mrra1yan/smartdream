async function run() {
  const url = "https://axzletfmciwquywhfxsq.supabase.co/rest/v1/links?url=eq.undefined&select=id,url";
  const res = await fetch(url, {
    headers: {
      "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4emxldGZtY2l3cXV5d2hmeHNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NTU1NzAsImV4cCI6MjA5OTUzMTU3MH0.syc4vHXqgfStCdT3an62qd-ol6Va3R94tEsLVCSGChE",
      "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4emxldGZtY2l3cXV5d2hmeHNxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Mzk1NTU3MCwiZXhwIjoyMDk5NTMxNTcwfQ.Vvq5fbo1ATFkWBlmbfdPsZvykIVNKvf3w7NyyajJBPw"
    }
  });
  console.log(await res.json());
}
run();
