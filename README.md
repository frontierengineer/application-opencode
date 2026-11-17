# OpenCode

A Frontier Runtime that runs [OpenCode](https://opencode.ai) as an agent on your
workers. It is one of Frontier's Initial Applications, written against
Frontier's Application Interface (`interfaces/application.d.ts`) like any other
Application.

OpenCode works at once with its free models, with nothing to sign in to. To use
your own model provider, you sign in to it once on each worker in OpenCode
itself, with `opencode auth login`. The Runtime never holds or asks for a
sign-in.

## What it does

On every worker, the worker bundle:

- **Probes** whether OpenCode is there and starts, and which models it offers.
  An `opencode` on the PATH or in `~/.opencode/bin` is used as it is.
- **Installs** `opencode-ai`, at the version this Application pins, into its own
  directory on the worker with npm when no OpenCode is found. A failed install
  is tried again after 1, 4, 16, then every 60 minutes, and its reason shows
  meanwhile.
- **Lists models** with `opencode models --verbose` in the background, again
  whenever the sign-ins change and otherwise every 12 hours. Models are grouped
  by provider and family, newest first, each with its context window and its
  variants as a setting.
- **Launches** one agent per session with `spawnAgent`, running `opencode acp`
  in the session's directory and speaking version 1 of the Agent Client Protocol.

The session's model, its variant and the agent definition reach OpenCode as
`OPENCODE_CONFIG_CONTENT`, merged over any the worker already sets:

- The model becomes `model`.
- An agent definition becomes a primary agent, set as `default_agent`, with its
  description, its instructions as `prompt`, and its tools as an allow list or
  its disallowed tools as a deny list.
- A variant is set on that agent, or on the `build` agent when there is no
  definition.

The surface bundle's **configuration view** shows OpenCode's state on every
worker, its models, and how to add a model provider.

## Layout

| Path | What |
| --- | --- |
| `contributions.json` | The Application as data: its runtime and configuration view. |
| `worker.ts`, `src/runtime.ts` | The runtime: probe, install and launch. |
| `src/config.ts` | The session's model, variant and agent definition as OpenCode config. |
| `src/models.ts` | Reading `opencode models` into the interface's models. |
| `src/definition.ts` | Reading an agent definition's front matter. |
| `src/installer.ts`, `src/machine.ts` | Finding npm and running installs once at a time. |
| `surface.ts`, `src/status-view.ts` | The configuration view. |
| `translations.json` | Every message a person reads, by token. |
| `test/` | Unit tests, with a fake npm and a fake `opencode` that speaks ACP. |

## Checking it

```sh
node scripts/check.mjs
```

It type-checks the sources against a Frontier checkout's Application Interface,
runs the tests with Node's test runner, and bundles each entry file the way the
Host does. It looks for the checkout at `../../frontier`, or at `FRONTIER_REPO`.
No test installs anything from the network or calls a model.

## License

MIT
