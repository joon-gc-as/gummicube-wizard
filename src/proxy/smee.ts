import SmeeClient from "smee-client";

if (!process.env.SMEE_URL) {
  throw new Error("SMEE_URL environment variable is required");
}

export function startSmeeProxy() {
  const smee = new SmeeClient({
    source: process.env.SMEE_URL!,
    target: `http://localhost:${process.env.PORT || 9898}/github/webhooks`,
    logger: console,
  });
  const events = smee.start();

  // Call events.close() to stop the proxy
  return events;
}
