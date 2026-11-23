/**
 * Books in the cloud (accounts only). Each book's text is one gzipped file in
 * the private Storage bucket `books` under the account's folder; the `books`
 * table keeps its title and where reading stopped, so the place follows you
 * between devices. A book removed on one device goes away on the others.
 */
import type { Book } from './books';
import { currentAccount, supabase } from './cloud';
import { db } from './db';

const DELETED_KEY = 'booksDeleted';
const BUCKET = 'books';

let applying = 0;
/** True while sync writes books here, so those writes don't count as changes. */
export const booksApplying = () => applying > 0;

async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  applying++;
  try {
    return await fn();
  } finally {
    applying--;
  }
}

interface BookRow {
  id: string;
  title: string;
  author: string | null;
  format: Book['format'];
  words: number;
  added_at: number;
  opened_at: number;
  pos: Book['pos'] | null;
  deleted: boolean;
}

/** Remembers a book removed here, so the next sync removes it everywhere. */
export async function noteBookDeleted(id: string) {
  const row = await db.kv.get(DELETED_KEY);
  const list = Array.isArray(row?.value) ? (row.value as string[]) : [];
  if (!list.includes(id)) await db.kv.put({ key: DELETED_KEY, value: [...list, id] });
}

async function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

async function gunzip(blob: Blob): Promise<string> {
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

const pathOf = (userId: string, id: string) => `${userId}/${id}.json.gz`;

const rowOf = (b: Book): Omit<BookRow, 'deleted'> & { deleted: false } => ({
  id: b.id,
  title: b.title,
  author: b.author ?? null,
  format: b.format,
  words: b.words,
  added_at: b.addedAt,
  opened_at: b.openedAt,
  pos: b.pos,
  deleted: false,
});

export async function syncBooks(): Promise<void> {
  const account = currentAccount();
  if (!account) return;
  const sb = supabase();
  const uid = account.id;
  const { data, error } = await sb.from('books').select('id,title,author,format,words,added_at,opened_at,pos,deleted').eq('user_id', uid);
  if (error) throw new Error(error.message);
  const remote = new Map(((data ?? []) as BookRow[]).map((r) => [r.id, r]));

  // Removed here since the last sync.
  const deleted = (((await db.kv.get(DELETED_KEY))?.value as string[] | undefined) ?? []).slice();
  for (const id of deleted) {
    if (remote.has(id) && !remote.get(id)!.deleted) {
      const { error: e } = await sb.from('books').update({ deleted: true, pos: null, updated_at: new Date().toISOString() }).eq('user_id', uid).eq('id', id);
      if (e) throw new Error(e.message);
      await sb.storage.from(BUCKET).remove([pathOf(uid, id)]);
      remote.set(id, { ...remote.get(id)!, deleted: true });
    }
  }
  if (deleted.length) {
    const now = ((await db.kv.get(DELETED_KEY))?.value as string[] | undefined) ?? [];
    await db.kv.put({ key: DELETED_KEY, value: now.filter((id) => !deleted.includes(id)) });
  }

  const local = await db.books.toArray();
  const here = new Set(local.map((b) => b.id));
  for (const b of local) {
    const r = remote.get(b.id);
    if (!r) {
      // New on this device: the text first, then the row that points to it.
      const { error: up } = await sb.storage.from(BUCKET).upload(pathOf(uid, b.id), await gzip(JSON.stringify(b)), { upsert: true, contentType: 'application/gzip' });
      if (up) throw new Error(up.message);
      const { error: ins } = await sb.from('books').upsert({ user_id: uid, ...rowOf(b), updated_at: new Date().toISOString() });
      if (ins) throw new Error(ins.message);
    } else if (r.deleted) {
      await quietly(() => db.books.delete(b.id));
    } else if (b.openedAt > r.opened_at) {
      const { error: e } = await sb.from('books').update({ pos: b.pos, opened_at: b.openedAt, updated_at: new Date().toISOString() }).eq('user_id', uid).eq('id', b.id);
      if (e) throw new Error(e.message);
    } else if (r.opened_at > b.openedAt && r.pos) {
      await quietly(() => db.books.update(b.id, { pos: r.pos!, openedAt: r.opened_at }));
    }
  }

  for (const r of remote.values()) {
    if (r.deleted || here.has(r.id) || deleted.includes(r.id)) continue;
    const { data: blob, error: e } = await sb.storage.from(BUCKET).download(pathOf(uid, r.id));
    if (e || !blob) {
      console.error(`Book ${r.id} could not be downloaded`, e);
      continue;
    }
    const book = JSON.parse(await gunzip(blob)) as Book;
    await quietly(() => db.books.put({ ...book, id: r.id, pos: r.pos ?? book.pos, openedAt: r.opened_at }));
  }
}
