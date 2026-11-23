import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const failures = {
  missing: 'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/opencode-ai\n',
  network: 'npm error code EAI_AGAIN\nnpm error syscall getaddrinfo\nnpm error errno EAI_AGAIN\nnpm error request to https://registry.npmjs.org/opencode-ai failed, reason: getaddrinfo EAI_AGAIN registry.npmjs.org\n',
  certificate: 'npm error code UNABLE_TO_GET_ISSUER_CERT_LOCALLY\nnpm error errno UNABLE_TO_GET_ISSUER_CERT_LOCALLY\nnpm error request to https://registry.npmjs.org/opencode-ai failed, reason: unable to get local issuer certificate\n',
};
if (process.env.FAKE_NPM_FAIL) {
  process.stderr.write(failures[process.env.FAKE_NPM_FAIL] ?? failures.missing);
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
