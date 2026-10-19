// Changes the sign-in password: asks for it (without echoing) and writes a new
// salt and PBKDF2 hash into src/lib/auth.ts. The password itself is never saved.
// Usage: npm run set-password
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { stdin, stdout } from 'node:process';

const FILE = new URL('../src/lib/auth.ts', import.meta.url);

let pending = '';

/** Reads one line without echoing it (also works with piped input). */
function ask(question) {
  return new Promise((resolve) => {
    stdout.write(question);
    let value = '';
    const feed = (chunk) => {
      for (let i = 0; i < chunk.length; i++) {
        const ch = chunk[i];
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          pending = chunk.slice(i + 1).replace(/^\n/, '');
          stdin.off('data', feed);
          stdin.setRawMode?.(false);
          stdin.pause();
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') process.exit(1);
        if (ch === '\u007f') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.setRawMode?.(true);
    stdin.setEncoding('utf8');
    stdin.on('data', feed);
    stdin.resume();
    if (pending) {
      const rest = pending;
      pending = '';
      feed(rest);
    }
  });
}

const source = readFileSync(FILE, 'utf8');
const iterations = Number(source.match(/const ITERATIONS = ([\d_]+)/)[1].replace(/_/g, ''));
const password = await ask('New password: ');
if (password.length < 8) {
  console.error('Use at least 8 characters.');
  process.exit(1);
}
if ((await ask('Repeat it: ')) !== password) {
  console.error('The two passwords are different.');
  process.exit(1);
}
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
writeFileSync(
  FILE,
  source.replace(/const SALT = '[0-9a-f]+';/, `const SALT = '${salt.toString('hex')}';`).replace(/const HASH = '[0-9a-f]+';/, `const HASH = '${hash}';`),
);
console.log('Done. Commit and push src/lib/auth.ts; the site updates in a minute or two.');
