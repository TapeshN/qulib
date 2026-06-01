// Fixture: Next.js App Router API route for users
// This file is a static analysis fixture only — not compiled.

export async function GET() {
  return { users: [] };
}

export async function POST(request: { json: () => Promise<unknown> }) {
  const body = await request.json();
  return { created: true, user: body };
}
