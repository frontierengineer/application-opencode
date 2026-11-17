import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (process.env.FAKE_NPM_FAIL) {
  process.stderr.write('npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/opencode-ai\n');
  process.exit(1);
}
const prefix = args[args.indexOf('--prefix') + 1];
const specification = args[args.length - 1];
const at = specification.lastIndexOf('@');
const name = specification.slice(0, at);
const version = specification.slice(at + 1);
if (process.env.FAKE_NPM_LOG) writeFileSync(process.env.FAKE_NPM_LOG, JSON.stringify(args));
const pkg = join(prefix, 'node_modules', name);
mkdirSync(join(pkg, 'bin'), { recursive: true });
writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name, version, bin: { opencode: 'bin/opencode' } }));
writeFileSync(join(pkg, 'bin', 'opencode'), `#!/bin/sh\nexec "${process.execPath}" "${join(here, 'fake-opencode.mjs')}" "$@"\n`);
chmodSync(join(pkg, 'bin', 'opencode'), 0o755);
mkdirSync(join(prefix, 'node_modules', '.bin'), { recursive: true });
symlinkSync(join('..', name, 'bin', 'opencode'), join(prefix, 'node_modules', '.bin', 'opencode'));
