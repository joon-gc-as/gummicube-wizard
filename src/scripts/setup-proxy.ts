async function getSmeeUrl(): Promise<string> {
  const response = await fetch("https://smee.io/new", { redirect: "manual" });
  const url = response.headers.get("location");
  if (!url) throw new Error("Failed to create smee.io channel");

  console.log(`Created new smee channel: ${url}`);
  console.log(`Add this to your .env: SMEE_URL=${url}`);

  return url;
}

async function setup() {
  await getSmeeUrl()
}

setup()
