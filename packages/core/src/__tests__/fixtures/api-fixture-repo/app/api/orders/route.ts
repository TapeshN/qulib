// Fixture: Next.js App Router API route for orders (DELETE only — high severity untested)
// This file is a static analysis fixture only — not compiled.

export async function DELETE(request: { url: string }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  return { deleted: true, id };
}
