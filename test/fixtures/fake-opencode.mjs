const [command, ...rest] = process.argv.slice(2);
if (process.env.FAKE_OPENCODE_BROKEN) {
  process.stderr.write('error while loading shared libraries: libstdc++.so.6\n');
  process.exit(127);
}
if (command === '--version') {
  process.stdout.write(`${process.env.FAKE_OPENCODE_VERSION ?? '1.19.6'}\n`);
  process.exit(0);
}
if (command === 'models') {
  const verbose = rest.includes('--verbose');
  const models = [
    { id: 'big-pickle', providerID: 'opencode', name: 'Big Pickle', family: 'big-pickle', release_date: '2026-09-01', limit: { context: 200000 }, variants: { low: {}, high: {} } },
    { id: 'claude-opus-5-5', providerID: 'anthropic', name: 'Claude Opus 5.5', family: 'claude-opus', release_date: '2026-10-01', limit: { context: 1000000 } },
    { id: 'claude-opus-4-8', providerID: 'anthropic', name: 'Claude Opus 4.8', family: 'claude-opus', release_date: '2026-05-01', limit: { context: 200000 } },
    { id: 'old-model', providerID: 'anthropic', name: 'Old', family: 'old', status: 'deprecated' },
  ];
  for (const model of models) {
    process.stdout.write(`${model.providerID}/${model.id}\n`);
    if (verbose) process.stdout.write(`${JSON.stringify(model, null, 2)}\n`);
  }
  process.exit(0);
}
if (command === 'acp') {
  let buffer = '';
  const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } });
      else if (message.method === 'session/new') {
        send({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'oc-1', _meta: { config: process.env.OPENCODE_CONFIG_CONTENT ?? null, cwd: process.cwd(), fromWorker: process.env.FROM_WORKER ?? null } } });
      }
    }
  });
  process.stdin.on('end', () => process.exit(0));
} else {
  process.stderr.write(`unknown command ${command}\n`);
  process.exit(2);
}
