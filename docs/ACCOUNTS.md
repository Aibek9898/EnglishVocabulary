# Аккаунты и облачная база (Supabase)

Сайт остаётся на GitHub Pages, а слова, прогресс, грамматика и книги каждого пользователя
хранятся в базе Supabase. Регистрации нет: аккаунты создаёт админ в Settings → Users.

## Как включить

1. supabase.com → New project.
2. Authentication → Users → Add user → Create new user (email, пароль, Auto Confirm User).
   Первый пользователь становится админом.
3. GitHub → Settings → Secrets and variables → Actions:
   - Variables: `SUPABASE_PROJECT_REF` = Project Settings → General → Project ID;
   - Secrets: `SUPABASE_ACCESS_TOKEN` = supabase.com/dashboard/account/tokens → Generate new token.
4. Actions → «Set up Supabase» → Run workflow (создаёт таблицы, закрывает регистрацию,
   выкладывает функцию `admin-users`), затем «Deploy to GitHub Pages» → Run workflow.

Пока переменных нет, сайт собирается как раньше: без аккаунтов, слова в браузере.

## Что где

- `supabase/schema.sql`: таблицы `profiles`, `vocab_state` (один сжатый JSON на аккаунт,
  с номером версии против перезаписи), `books` (название и место чтения) и бакет Storage `books`.
  Везде RLS: каждый видит только своё.
- `supabase/functions/admin-users`: создание, список, смена пароля и удаление аккаунтов.
  Сервисный ключ есть только там.
- `src/lib/cloud.ts`: вход, выход, смена пароля, вызовы админ-функции.
- `src/lib/sync.ts`: та же синхронизация, что была для GitHub, но с базой.
- `src/lib/bookSync.ts`: книги.
- `src/lib/migrate.ts`: перенос слов и книг «из до-аккаунтов» в аккаунт на этом устройстве.
  Старая база в браузере не удаляется.
