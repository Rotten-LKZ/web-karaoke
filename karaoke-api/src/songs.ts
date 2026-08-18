import songs from '../../songs.json';

interface SongEntry {
  slug: string;
  title: string;
  artist: string;
  key: string;
  /** 原唱音轨（可选）：七牛对象 key。 */
  original?: string;
}

const data = songs as SongEntry[];

const bySlug = new Map(data.map((s) => [s.slug, s]));

/** 白名单列表（不含 key），供前端选歌。 */
export function listSongs(): { slug: string; title: string; artist: string }[] {
  return data.map(({ slug, title, artist }) => ({ slug, title, artist }));
}

/** 按 slug 查找完整条目；不在白名单返回 undefined。 */
export function getSong(slug: string): SongEntry | undefined {
  return bySlug.get(slug);
}
