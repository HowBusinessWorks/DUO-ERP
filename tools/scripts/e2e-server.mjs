import { spawn, spawnSync } from 'node:child_process';

/**
 * Ridica aplicatia pentru testele de tapuri.
 *
 * Exista din cauza unui detaliu care nu se vede: **Next inlocuieste
 * `process.env.X` la BUILD, nu la rulare** — inclusiv in middleware, care ruleaza
 * pe Edge. Adica `ALLOW_DEV_SESSION` pus doar la pornire n-ajunge niciodata in
 * bundle, iar middleware-ul trimite la login orice cerere, cu cookie de
 * dezvoltare cu tot. Prima varianta a testelor a picat exact asa, pe trei teste
 * deodata, cu un ecran de login in loc de ecranul de teren.
 *
 * De aceea steagul se pune INAINTE de build, si de aceea build-ul asta e al lui:
 * un bundle cu `ALLOW_DEV_SESSION=1` accepta o sesiune fabricata dintr-un cookie
 * si **nu are voie sa ajunga niciodata intr-un deploy**. Se construieste aici,
 * se foloseste aici.
 */

const PORT = process.env.E2E_PORT ?? '3100';

const env = {
  ...process.env,
  ALLOW_DEV_SESSION: '1',
  NODE_ENV: 'production',
  // Fara al doilea factor: sesiunea de dezvoltare n-are cont in spate, deci
  // n-are ce factor sa dovedeasca.
  MFA_ENFORCED: '0',
};

const build = spawnSync('pnpm', ['--filter', '@damina/web', 'build'], {
  stdio: 'inherit',
  env,
  shell: true,
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const server = spawn('pnpm', ['--filter', '@damina/web', 'start', '--port', PORT], {
  stdio: 'inherit',
  env,
  shell: true,
});

server.on('exit', (code) => {
  process.exit(code ?? 0);
});
