// Edge Function: the admin makes, lists, resets and removes accounts.
// Only this function holds the service key (Supabase provides it here); the
// site sends the signed-in person's token, and we check they are the admin.
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (error: string, status = 400) => reply({ error }, status);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('Use POST.', 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  // Who is asking?
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return fail('Sign in first.', 401);
  const { data: who, error: whoError } = await admin.auth.getUser(token);
  if (whoError || !who.user) return fail('Your sign-in has expired. Sign in again.', 401);
  const { data: me } = await admin.from('profiles').select('is_admin').eq('id', who.user.id).maybeSingle();
  if (!me?.is_admin) return fail('Only the admin can manage accounts.', 403);

  let body: { action?: string; email?: string; password?: string; name?: string; id?: string };
  try {
    body = await req.json();
  } catch {
    return fail('Bad request.');
  }

  switch (body.action) {
    case 'list': {
      const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
      if (error) return fail(error.message, 500);
      const { data: profiles } = await admin.from('profiles').select('id,name,is_admin');
      const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
      const users = data.users
        .map((u) => ({
          id: u.id,
          email: u.email ?? '',
          name: byId.get(u.id)?.name ?? (u.user_metadata?.name as string | undefined) ?? undefined,
          isAdmin: !!byId.get(u.id)?.is_admin,
          createdAt: u.created_at,
          lastSignIn: u.last_sign_in_at ?? undefined,
        }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return reply({ users });
    }

    case 'create': {
      const email = (body.email ?? '').trim().toLowerCase();
      const password = body.password ?? '';
      const name = (body.name ?? '').trim().slice(0, 80);
      if (!EMAIL.test(email)) return fail('Type a full email address.');
      if (password.length < 8) return fail('The password needs at least 8 characters.');
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: name ? { name } : {} });
      if (error) return fail(/already|exists|registered/i.test(error.message) ? 'There is already an account with this email.' : error.message);
      return reply({ user: { id: data.user.id, email, name: name || undefined, isAdmin: false, createdAt: data.user.created_at } });
    }

    case 'password': {
      if (!body.id || (body.password ?? '').length < 8) return fail('The password needs at least 8 characters.');
      const { error } = await admin.auth.admin.updateUserById(body.id, { password: body.password });
      if (error) return fail(error.message, 500);
      return reply({ ok: true });
    }

    case 'delete': {
      if (!body.id) return fail('Which account?');
      if (body.id === who.user.id) return fail("You can't remove your own account.");
      // Their book files first; the rows go with the account.
      const { data: files } = await admin.storage.from('books').list(body.id, { limit: 1000 });
      if (files?.length) await admin.storage.from('books').remove(files.map((f) => `${body.id}/${f.name}`));
      const { error } = await admin.auth.admin.deleteUser(body.id);
      if (error) return fail(error.message, 500);
      return reply({ ok: true });
    }

    default:
      return fail('Unknown action.');
  }
});
