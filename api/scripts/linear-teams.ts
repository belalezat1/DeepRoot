// Prints your Linear teams so you can copy the team ID into api/.env.
// Run from the repo root: npm run linear:teams -w api
const apiKey = process.env.LINEAR_API_KEY;
if (!apiKey) {
  console.error("Set LINEAR_API_KEY in api/.env first.");
  process.exit(1);
}

const res = await fetch("https://api.linear.app/graphql", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: apiKey },
  body: JSON.stringify({ query: "{ teams { nodes { id key name } } }" }),
});
const json = await res.json();
if (!res.ok || json.errors) {
  console.error("Linear returned an error:", JSON.stringify(json.errors ?? json, null, 2));
  process.exit(1);
}
console.table(json.data.teams.nodes);
