// Fixture: Next.js Pages API route
// This file is a static analysis fixture only — not compiled.

export default function handler(
  req: { method?: string },
  res: { status: (code: number) => { json: (data: unknown) => void; end: () => void } }
) {
  if (req.method === 'GET') {
    res.status(200).json({ status: 'ok' });
  } else {
    res.status(405).end();
  }
}
