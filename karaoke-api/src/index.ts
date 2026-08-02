import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { signQiniuUrl } from './sign';
import { getSong, listSongs } from './songs';

interface Env {
  CDN_DOMAIN: string;
  QINIU_AK: string;
  QINIU_SK: string;
  CORS_ORIGIN: string;
  TTL_SECONDS?: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  const origins = (c.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return cors({
    origin: (origin) => {
      if (!origin) return origins[0] ?? '*';
      return origins.includes(origin) ? origin : null;
    },
    allowMethods: ['GET', 'OPTIONS'],
    allowHeaders: ['content-type'],
  })(c, next);
});

app.get('/health', (c) => c.json({ ok: true, service: 'karaoke-api' }));

app.get('/songs', (c) => c.json({ songs: listSongs() }));

app.get('/sign/:slug', async (c) => {
  const song = getSong(c.req.param('slug'));
  if (!song) return c.json({ error: 'song not found' }, 404);

  const expiresIn = Number(c.env.TTL_SECONDS ?? '1800');
  const url = await signQiniuUrl(c.env, song.key, expiresIn);
  return c.json({ url, expiresIn, slug: song.slug, title: song.title });
});

app.notFound((c) => c.json({ error: 'not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

export default app;
