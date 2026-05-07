const required = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
];

const optional = ["DEEPSEEK_API_KEY", "MAX_CONCURRENT_JOBS", "GENERATION_TIMEOUT_MS"];

let failed = false;
console.log("Checking deployment environment variables...");

for (const name of required) {
  if (process.env[name]) {
    console.log(`OK   ${name}`);
  } else {
    console.log(`MISS ${name}`);
    failed = true;
  }
}

for (const name of optional) {
  console.log(`${process.env[name] ? "OK  " : "SKIP"} ${name}`);
}

if (failed) {
  console.error("Deployment environment check failed. Add the missing variables in Vercel Project Settings.");
  process.exit(1);
}

console.log("Deployment environment check passed.");
