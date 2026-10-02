# jev-gateway

A local LLM gateway for coding agents. When your agent is about to decide **which tool to call**,
the gateway asks [Jev](https://docs.typesafe.ai/introduction), TypeSafe's fast decision model,
instead of leaving that choice to the expensive reasoning model. Everything else goes to your usual
LLM untouched.

Tool selection can also run on your machine with [Nimble](https://github.com/bespokelabsai/nimble)
through Ollama, without a Jev API key. See [Local Nimble with Ollama](#local-nimble-with-ollama).

It works with **Codex**, **Claude Code**, **OpenCode** and **Kilo** out of the box, including on
ChatGPT and claude.ai subscriptions, with Gemini API clients, and with any client that speaks the
OpenAI, Anthropic or Google Gemini APIs.

> Independent project, not affiliated with or endorsed by TypeSafe. "Jev" is TypeSafe's model and
> this gateway is a client of its public API.

## Quick start

You need Node.js 22.15 or newer, either a key for Jev (from TypeSafe, OpenRouter, Vercel AI Gateway or
OpenCode, see [Where Jev runs](#where-jev-runs)) or local Nimble through Ollama, and your coding
agent already installed with its usual provider credentials.

**1. Install**

```bash
npm install -g jev-gateway
```

**2. Run your agent through the gateway**

```bash
jev-codex      # use it exactly like `codex`
jev-claude     # use it exactly like `claude`
jev-opencode   # use it exactly like `opencode` (stable v1)
jev-kilo       # Kilo CLI, on free models unless KILO_API_KEY is set
jev-gemini     # Gemini CLI, with a Gemini API key
jev-devin      # use it exactly like `devin`
```

**3. Choose a tool-selection provider, once**

The first time, the launcher asks which provider to use. For hosted Jev, it asks for the key,
checks it with one real call, and saves the settings to `~/.jev-gateway/.env` (readable only by you).
For local Nimble, choose option 5 and enter the Ollama server URL and model name; no key is needed.
Every `jev-` command shares that file, so you are asked once for all of them.

```text
Where do you want to reach Jev?
  1) TypeSafe: the official API, direct from the makers of Jev
  2) OpenRouter: Jev through your OpenRouter account and credits
  3) Vercel AI Gateway: Jev through your Vercel AI Gateway key and billing
  4) OpenCode: Jev through your OpenCode Zen key: free by default, paid only if selected
  5) Ollama (Nimble): Nimble on your machine, without an API key
Choose 1-5 [1]:
Paste your TypeSafe API key (input is hidden):
The key works (Jev answered in 712 ms).
```

**4. Watch it work**

```bash
jev-codex --dashboard
```

That's it. Your existing login keeps working, nothing in `~/.codex`, `~/.claude`,
`~/.config/opencode`, or `~/.config/kilo` is changed, and plain `codex`, `claude`, `opencode`,
and `kilo` still behave as before. Only sessions started with the `jev-` commands go through the
gateway.

## What to expect

- The first `jev-codex`, `jev-claude`, `jev-opencode`, or `jev-kilo` starts a small gateway in the
  background and then opens your agent. Every argument is passed through, so `jev-codex exec "fix the
  failing test"` works like `codex exec "fix the failing test"`.
- The gateway keeps running after you close the agent, so the next session starts instantly. Stop it
  with `--stop`.
- Each turn, the gateway asks the configured model, hosted Jev or local Nimble, which tool fits.
  When it is confident, the gateway steers the LLM to that tool. Otherwise, the request goes through
  unchanged.
- If tool selection fails, times out, or returns incomplete scores, the original request goes
  straight to the LLM.
- It listens on `127.0.0.1` only.

## Commands

All of these work with `jev-codex`, `jev-claude`, `jev-opencode`, `jev-kilo`, `jev-gemini` and
`jev-devin`.

| Command | What it does |
| --- | --- |
| `jev-codex [args]` | Start the gateway if needed, then run Codex through it |
| `jev-codex --dashboard` | Open the monitoring dashboard in your browser |
| `jev-codex --routing off` | Baseline mode: stop asking the tool-selection model, keep counting tokens |
| `jev-codex --routing on` | Enable tool selection again |
| `jev-codex --status` | Is the gateway running, and where does it forward to? |
| `jev-codex --doctor` | Inspect installation, configuration sources, running build and Ollama model availability |
| `jev-codex --logs` | Follow routing decisions live (use a second terminal) |
| `jev-codex --start` | Start the gateway without opening the agent |
| `jev-codex --stop` | Stop the background gateway (close your sessions first) |
| `jev-codex --setup` | Choose hosted Jev or local Nimble, or change provider settings |
| `jev-codex --print-config` | Print settings to point plain `codex` at the gateway permanently |
| `jev-codex --gateway-help` | List all of the above |

Codex uses port 8790, Claude Code 8789, OpenCode 8791, Gemini clients 8788, Devin 8792 and Kilo
8793. Change them with `JEV_CODEX_PORT`, `JEV_CLAUDE_PORT`, `JEV_OPENCODE_PORT`,
`JEV_GEMINI_PORT`, `JEV_DEVIN_PORT` and `JEV_KILO_PORT`.

## Dashboard

```bash
jev-codex --dashboard     # or: jev-claude --dashboard, jev-opencode --dashboard, jev-kilo --dashboard
```

This opens `http://localhost:8790/dashboard`. If no browser window appears, paste that address into
your browser. One page shows each gateway (Codex, Claude, OpenCode, Kilo, Gemini and
Devin) and refreshes every 2 seconds.

To find the other gateways, the page tries their default ports. A port that never answered is
tried again after 10 seconds, then less often, down to once a minute; each try that finds nothing
shows as a refused connection in the browser console. Add `?peers=none` to the address to watch
only the gateway that serves the page.

You will see:

- **A status per gateway:** Routing, Passthrough only, Jev is failing, Idle, Baseline, or Offline,
  with a one-line explanation.
- **Why requests were not routed,** with each reason explained in plain English.
- **Jev's numbers:** calls, latency, confidence, and what it cost.
- **LLM tokens:** input (and how much came from the prompt cache), output (and how much was hidden
  reasoning), and seconds per request.
- **A live table** of recent requests. A request appears when its reply finishes, because that is
  when the provider reports its tokens.

The dashboard only shows request metadata. Prompts, tool arguments, and credentials never reach it.
Routing decisions carry their provider and model. Local Nimble reports actual Ollama generate
requests separately from decisions, plus model loading, prompt evaluation, evaluation and native
total time in milliseconds. Counts include attempted requests that fail; available measurements
survive a later-stage failure. Routing latency covers the whole decision. Missing timings and
historical counts appear as unavailable. Hosted cost estimates exclude local and unknown-provider
history; the displayed rate is a reference estimate, not an Ollama charge.

### Is it worth it? Compare with a baseline

Switch routing off to measure the same work without Jev. The gateway keeps forwarding and counting
tokens, but never asks Jev and rewrites nothing.

```bash
jev-codex --routing off    # do a task
jev-codex --routing on     # do a similar task
```

The same switch is a button on each gateway card. The "Token use" card then shows both states side
by side: tokens in and out per request, cache share, reasoning tokens, and seconds. The comparison
is only meaningful if you do similar work in both states.

## Where Jev runs

Jev is served by TypeSafe and by three gateways that resell it. All four take the same questions
and return the same answers, so the choice is about whose account and billing you want to use.
Ollama runs Nimble locally as an alternative tool-selection model.

| Provider | Key variable | Default model | Get a key |
| --- | --- | --- | --- |
| TypeSafe (official) | `TYPESAFE_API_KEY` | `jev-latest` | [typesafe.ai](https://typesafe.ai) |
| OpenRouter | `OPENROUTER_API_KEY` | `typesafe/jev-1.13` | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` | `typesafe-ai/jev` | [Vercel dashboard](https://vercel.com/dashboard/ai-gateway/api-keys) |
| OpenCode | `OPENCODE_API_KEY` | `jev-1.13-free` | [OpenCode Zen](https://opencode.ai/auth) |
| Ollama (Nimble) | none | `nimble:latest` | [Local setup](#local-nimble-with-ollama) |

OpenCode serves two ids at the same endpoint: `jev-1.13-free` (free,
[for a limited time](https://opencode.ai/docs/zen/#jev)) and the paid `jev-1.13`. The gateway
defaults to the free one. If OpenCode says the free model is gone (404 or 410), the request goes
to the LLM unchanged. The reason names `JEV_MODEL=jev-1.13`, which opts into the paid model.
The setup wizard offers to save that setting if only the paid model answers its key check.

`jev-codex --setup` (or any other launcher) saves the selected provider and model, and stops that
client's running gateway so its next launch uses the new settings. To configure hosted Jev by hand,
put `JEV_PROVIDER` and the matching key in `~/.jev-gateway/.env` or in your environment. Without
`JEV_PROVIDER`, the gateway uses whichever key it finds, TypeSafe's first. `JEV_MODEL` picks another
model; hosted providers ignore ids outside their supported namespace, while Ollama accepts local
names as written. When switching manually, set the model for the new provider too. `--status` and
the dashboard show which provider is in use.

With no terminal to ask in (CI, scripts), a launcher does not wait for input: it exits and names
the variables it looked for.

The TypeSafe and OpenCode paths are run against the real APIs. On 2026-09-24, the setup key
check succeeded with a real OpenCode Zen key for both `jev-1.13-free` and paid `jev-1.13`. This
confirms that the paid model answered the check; the account's billing history was not inspected.
The unavailable-free-model behavior and setup consent flow remain test-only because the free model
still answers. The OpenRouter and Vercel paths follow those providers' published endpoints and are
covered by tests, but have not been run with real keys yet. The first-run key check will tell you
at once if one of them disagrees.

### Local Nimble with Ollama

Run `jev-codex --doctor` (or `jev-claude --doctor`, `jev-opencode --doctor`) when setup or
routing does not match your expectations. From a checkout, use `npm run codex -- --doctor`.
It prints the package path, version, content fingerprint, executable selected by `PATH`,
configuration precedence and the source of the provider/model settings. Key values and URL
credentials are omitted. For Ollama it checks the server version and model availability without
running inference. It never starts, stops or reconfigures a gateway.

New gateways report their build identity in `/health`; a gateway started before this feature
cannot report it. Different code can share the same release version, so compare fingerprints
as well as versions. Leave active sessions running and restart later to adopt new gateway code.
With `ROUTER_API_KEY` configured, health still reports only that the service is up.

To install changes from this checkout in one command, with development dependencies already installed:

```bash
npm run update-local
```

Run it from a full checkout after `pnpm install`, with Node.js 22.15 or newer and npm available.
The command snapshots the checkout, checks types and tests, builds and packs it in a temporary
directory, then installs and verifies a fresh copy under `~/.jev-gateway/installs/`. It switches
`~/.jev-gateway/current` only after verification. Add `~/.jev-gateway/current/bin` to `PATH` once
to use these launchers. Existing gateway processes keep their old files and configuration;
restart them after their active sessions finish to adopt the new code. Global npm files and
client configuration files are left untouched. Old installs remain available for rollback.
Failed checks remove the temporary snapshot and any new installation created by that run;
`current` keeps its previous target. The `PATH` change selects the installed `jev-*` commands;
`npm run codex` and other checkout scripts continue to use the checkout.

To roll back, replace `current` with a symlink to a previous installation, then restart gateways
after their active sessions finish. For example, substitute your retained installation path:

```bash
node --input-type=module -e '
import { activateInstall } from "./scripts/update-local.mjs";
activateInstall(process.argv[1], process.argv[2]);
' "$HOME/.jev-gateway/installs/PREVIOUS_INSTALL" "$HOME/.jev-gateway/current"
```

Use `npm run update-local -- --prefix /absolute/path/to/new-directory` to verify a separate
installation without switching `current`. The destination must not exist. This also works when
the gateway serving your coding session runs from this checkout, because the checkout's `dist/`
is not rebuilt by the updater.

Use Ollama 0.35.0 or newer with a local model built from the September 24, 2026
[Bespoke-Nimble-9B checkpoint](https://huggingface.co/bespokelabs/Bespoke-Nimble-9B).
Check the name with `ollama list`; the examples use an already installed `nimble:latest`.
If Ollama is not running, start the Ollama app or run `ollama serve`.

The same local Nimble settings work with Codex, Claude Code and OpenCode. From a checkout,
install the dependencies:

```bash
npm install
```

Put the shared settings in the checkout's `.env`:

```dotenv
JEV_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
JEV_MODEL=nimble:latest
```

Choose the client to start:

```bash
npm run codex
npm run claude
npm run opencode
```

Each command starts its own gateway; run only the clients you need. Kilo, Gemini and Devin use
the same tool-selection settings through their respective launchers.

| Client | Checkout command | Installed launcher | Default port | How Nimble's selection is used |
| --- | --- | --- | --- | --- |
| Codex | `npm run codex` | `jev-codex` | `8790` | Forces a supported tool; unsupported or namespaced selections pass through |
| Claude Code | `npm run claude` | `jev-claude` | `8789` | Adds a tool suggestion with thinking or prompt caching; Claude decides whether to follow it |
| OpenCode | `npm run opencode` | `jev-opencode` | `8791` | Forces a tool for requests using the injected `jev-gateway` provider |

Launchers read shell variables first, then this checkout's `.env`, then `~/.jev-gateway/.env`.
One Ollama server serves all clients, but their gateway processes and logs are separate.

Installed launchers can use the same variables in `~/.jev-gateway/.env`, or any launcher's
`--setup` command and option 5.
Setup checks that Ollama has the named model; the first routing request checks inference and
logprob support. A custom model name, including a tag or namespace, is accepted as written.
`OLLAMA_BASE_URL` is the server root, without `/v1` or `/api/generate`.
`JEV_URL` can override the full endpoint. After changing the settings, close active agent sessions
and stop each gateway that was already running:

```bash
npm run codex -- --stop
npm run claude -- --stop
npm run opencode -- --stop
```

The next launch reads the new settings. Use `jev-codex --stop`, `jev-claude --stop` or
`jev-opencode --stop` after installation. Status, logs and dashboards use the same command pattern,
for example `npm run claude -- --status` or `npm run opencode -- --dashboard`.

Nimble selects tools; the agent's upstream LLM still writes replies and fills tool arguments.
Codex and Claude Code reuse their existing login or API credentials. OpenCode defaults to the
OpenAI upstream and `gpt-5`, with `OPENAI_API_KEY` for that LLM. Use `JEV_OPENCODE_MODEL` and
`JEV_OPENCODE_UPSTREAM_BASE_URL` to choose its upstream model and provider; see
[Credentials and upstream](#credentials-and-upstream). OpenCode requests that explicitly select
another provider bypass this gateway and its Nimble routing.

The gateway sends one raw, non-thinking Qwen classification prompt per question to
`/api/generate` and scores the answer codes from real token logprobs. Ollama returns at most
20 alternatives, so choice confidence uses the probability across the full vocabulary and
does not renormalize the returned subset. Missing candidates are omitted from the reported
probabilities. Boolean questions require both answer scores and normalize those two.
These confidence values differ from hosted Jev's; tune thresholds on your own tasks.

The local defaults are a 30-second timeout for the whole decision, 12,000 characters of
conversation, 2,000 characters of system instructions, and `JEV_DIRECT_CALLS=false`.
Tool lists over 48 entries are shortlisted with shorter descriptions. Each question is scored
separately, so larger tool lists and direct argument filling add local inference calls.
Set `JEV_DIRECT_CALLS=true` to enable closed-set argument filling. Nimble first selects a tool
and checks whether a tool is needed. Only a confident, consistent selection can trigger questions
for that tool's closed arguments. Thinking, unsupported tools and open arguments need no extra
local inference. Shortlisting, selection and argument questions share one timeout; tokens and
latency include every stage. An argument-stage error forwards the original request upstream.
Hosted Jev continues to batch speculative arguments for all eligible tools.

The model stays loaded for
10 minutes after a request. Its context is fixed at 8,192 tokens; Ollama is instructed to reject
oversized prompts instead of truncating them. If the model is missing, slow, returns incomplete
scores, or cannot fit a prompt, the original request goes to your LLM unchanged.

The local transport was checked on Ollama 0.35.0 with `nimble:latest`: forced tool selection,
plain-text replies, an Anthropic thinking hint, closed-set argument filling, extended answer codes,
and rejection of oversized prompts. Complete Codex 0.160.0 subscription sessions passed in Ukrainian
and English with routing on, off and Ollama unavailable. Claude Code 2.1.207 reached a thinking/cache
hint, but its upstream rejected authentication with HTTP 401; its complete sessions remain unverified.
OpenCode 1.18.16 had no credential for the gateway's upstream, so its complete sessions remain
unverified. See the [session verification report](docs/nimble-session-verification.md) for measured
latency, tokens, sample size and the repeatable scenario.

## Using it with Codex

`jev-codex` reuses your existing Codex login. With a ChatGPT subscription the gateway forwards to
`https://chatgpt.com/backend-api/codex`. With an API key it forwards to `https://api.openai.com/v1`.
Override either with `JEV_CODEX_UPSTREAM_BASE_URL`.

For local Nimble, use the [shared Ollama settings](#local-nimble-with-ollama) and run
`npm run codex` from the checkout, or `jev-codex` after installation.

Codex speaks the Responses API, so the gateway handles `POST /v1/responses`, including Codex's
free-form tools such as `apply_patch`, tools declared inside the conversation, and compressed
request bodies. If the backend rejects a rewritten request, the gateway resends the original, so
Codex never sees an error caused by the gateway.

## Using it with Claude Code

`jev-claude` runs `claude` with only `ANTHROPIC_BASE_URL` set. Claude Code keeps using its saved
login, so a claude.ai subscription keeps working and its usual limits apply.

For local Nimble, use the [shared Ollama settings](#local-nimble-with-ollama) and run
`npm run claude` from the checkout, or `jev-claude` after installation. The same `hint` behavior
below applies when Nimble selects the tool.

Jev can do less here than with Codex, because of how the Anthropic API works. Claude Code runs with
extended thinking, and the API rejects a forced tool while thinking is on. It also rereads a cached
conversation on every turn, and changing `tool_choice` would invalidate that cache. So for Claude
Code the gateway adds a short suggestion to the request instead (`hint` mode), which the model is
free to ignore. Expect better tool picks on large tool lists, not lower cost or latency.

## Using it with OpenCode

Tested with stable OpenCode v1.18.31. OpenCode v2 is out of scope: no `previous_response_id`
chaining, namespaces, or `additional_tools` behavior is assumed.

For local Nimble, use the [shared Ollama settings](#local-nimble-with-ollama) and run
`npm run opencode` from the checkout, or `jev-opencode` after installation. Nimble needs no key;
the upstream LLM still uses the credentials described below.

**Quick path**

```bash
jev-opencode   # use it exactly like `opencode`
```

That starts the gateway on `http://127.0.0.1:8791` if needed, then runs `opencode` through it
with a `jev-gateway` custom provider injected via `OPENCODE_CONFIG_CONTENT`. Your
`~/.config/opencode` files are never written, and every `opencode` flag (including `-m`) forwards
untouched. The launcher uses stable `@ai-sdk/openai-compatible`, so OpenCode speaks
`POST /v1/chat/completions` off `http://127.0.0.1:8791/v1` by default, an endpoint the gateway
already routes.

### What goes through the gateway, and what does not

Codex and Claude Code have one endpoint, so pointing them at the gateway covers everything they
send. OpenCode chooses a provider per model, and the launcher only makes a gateway model the
*default*. So:

| Request | Through the gateway? |
| --- | --- |
| Agents and subagents with no `model` of their own (`build`, `plan`, `general` out of the box) | Yes: they use the default |
| Session titles and other small-model work | Yes (`small_model` is set too), so some traffic on the dashboard does not mean your agents are covered |
| An agent with its own `model`, in `opencode.json` (`agent.<name>.model`) or in its markdown file (`model:`) | **No.** It goes straight to that model's provider, and Jev never sees it |
| A session started with `-m` / `--model` naming another provider | **No**, by your choice |

The launcher does not rewrite the models you chose. It tells you instead: before OpenCode starts,
and whenever you run `jev-opencode --status`, it lists what will bypass the gateway.

```text
jev-opencode: these go straight to their provider, not through the gateway, because they name a model of their own:
  - agent "build" (anthropic/claude-sonnet-4-5)
  - agent "reviewer" (openai/gpt-5)
Jev only sees requests to jev-gateway/* models. Agents without a model of their own use the default and are covered.
```

To bring an agent under the gateway, give it a `jev-gateway/<model>` model or remove its `model`
line. The gateway forwards to one upstream (`JEV_OPENCODE_UPSTREAM_BASE_URL`), so agents on
different providers cannot all be routed at once.

The list comes from OpenCode itself (`opencode debug config`, its own merge of every config
source), which costs about a second at start-up. `JEV_OPENCODE_CHECK=off` skips it. If OpenCode
cannot be asked, the launcher says nothing and starts as usual.

An `OPENCODE_CONFIG_CONTENT` you already set is kept, comments and trailing commas included: the
launcher lays its default models and the `jev-gateway` provider over it, and leaves the rest
(agents, permissions, other providers) alone. Content that is not a JSON object cannot be merged,
so the session gets only the launcher's settings, and the launcher says so before OpenCode starts.

On the dashboard, a gateway that shows **Idle** received nothing, which is what a bypassing agent
looks like. One that shows **Passthrough only** received requests and did not route them, with
the reason for each.

Manage it like the other launchers:

```bash
jev-opencode --gateway-help   # list launcher commands (`--help` stays opencode's own help)
jev-opencode --print-config   # opencode.json snippet to point plain `opencode` at the gateway
jev-opencode --start          # start the gateway without opening opencode
jev-opencode --stop           # stop the background gateway
jev-opencode --status         # is the gateway running, where does it forward to, and what bypasses it?
jev-opencode --dashboard      # open the monitoring dashboard in your browser
```

### Credentials and upstream

| Variable | Default | Meaning |
| --- | --- | --- |
| `JEV_PROVIDER` | whichever hosted key is set | Set to `ollama` for local Nimble; independent of OpenCode's upstream LLM provider |
| `TYPESAFE_API_KEY` | required for TypeSafe only | Authorizes hosted Jev tool selection. Other hosted providers use their own key; Ollama needs none |
| `OPENAI_API_KEY` | your key | Your LLM credential. OpenCode resolves `{env:OPENAI_API_KEY}` and the gateway forwards it untouched to the LLM upstream |
| `JEV_OPENCODE_UPSTREAM_BASE_URL` | `https://api.openai.com/v1` | Where the gateway forwards OpenCode traffic: your LLM provider, not the TypeSafe endpoint |
| `JEV_OPENCODE_MODEL` | `gpt-5` | Model selected as `jev-gateway/<model>` |
| `JEV_OPENCODE_PORT` | `8791` | Router port for OpenCode |
| `JEV_OPENCODE_CHECK` | on | `off` skips asking OpenCode which agents bypass the gateway, which saves about a second at start-up |

The gateway forwards the client's `Authorization` header to the LLM upstream. A launcher-spawned
gateway strips `UPSTREAM_API_KEY`/`ROUTER_API_KEY` by design, so the client's own key always
flows through and no gateway key swap applies on this path. (Standalone server mode can hold the
provider key with `UPSTREAM_API_KEY`; see "Running it as a server" below.)

### Manual setup

Keep the gateway running, then point plain `opencode` at it with a file, so no shell quoting is needed:

```bash
jev-opencode --start
jev-opencode --print-config   # copy the opencode.json snippet it prints
```

Chat Completions (the launcher default, stable `@ai-sdk/openai-compatible`):

```json
{
  "model": "jev-gateway/gpt-5",
  "small_model": "jev-gateway/gpt-5",
  "provider": {
    "jev-gateway": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Jev Gateway",
      "options": {
        "baseURL": "http://127.0.0.1:8791/v1",
        "apiKey": "{env:OPENAI_API_KEY}"
      },
      "models": {
        "gpt-5": {
          "name": "Jev Gateway (gpt-5)"
        }
      }
    }
  }
}
```

Responses (stable `@ai-sdk/openai` instead):

```json
{
  "model": "jev-gateway/gpt-5",
  "small_model": "jev-gateway/gpt-5",
  "provider": {
    "jev-gateway": {
      "npm": "@ai-sdk/openai",
      "name": "Jev Gateway",
      "options": {
        "baseURL": "http://127.0.0.1:8791/v1",
        "apiKey": "{env:OPENAI_API_KEY}"
      },
      "models": {
        "gpt-5": {
          "name": "Jev Gateway (gpt-5)"
        }
      }
    }
  }
}
```

Save either block as `opencode.json` in the project root or `~/.config/opencode/opencode.json`,
then select it with `opencode --model jev-gateway/gpt-5`.

`baseURL` includes `/v1`; OpenCode and the AI SDK append the rest (`/chat/completions` for
`@ai-sdk/openai-compatible`, `/responses` for `@ai-sdk/openai`). Both endpoints are routed by the
gateway above.

### Tools and routing

Native OpenCode tools and MCP tools converge on the wire to `type: "function"` function tools. MCP
naming was not captured live; the equivalence verified is the wire shape: an MCP tool arrives as
the same function-tool definition a native tool does, so the gateway offers both to Jev the same
way.

Expected modes (reported in `x-jev-gateway-mode`):

| Mode | When |
| --- | --- |
| `forced` | Jev picked a tool but some arguments are open-ended, so the LLM fills them in |
| `none` | Jev is confident no tool is needed (`tool_choice: "none"`) |
| `passthrough` | Low confidence, Jev failed, no tools, or the caller already decided. Forwarded untouched |
| `direct` | Jev picked a tool and every argument is an enum, boolean, or constant. Answered with no LLM call |

Most OpenCode tools take open text (`bash` takes a command, `read` takes a path), so `forced`
is the usual outcome: Jev picks the tool and the LLM fills in the free-form arguments. `direct`
needs a fully closed schema (only enums, booleans, or constants), which fits small MCP-style tools
with fixed choices rather than everyday file and shell tools.

The launcher sets `OPENCODE_EXPERIMENTAL_NATIVE_LLM=false` and
`OPENCODE_EXPERIMENTAL_CODE_MODE=false` for the launched process only. Those experimental modes
are outside the supported path; the stable AI SDK provider above is the supported one.

## Using it with Kilo

Tested with Kilo CLI 7.0.29.

```bash
jev-kilo   # runs `kilo` with its own provider: see below for the model and key it uses
```

Kilo CLI is built on OpenCode, so `jev-kilo` works the way `jev-opencode` does: it starts the
gateway on `http://127.0.0.1:8793` if needed, then runs `kilo` with a `jev-gateway` custom provider
injected through `KILO_CONFIG_CONTENT`. Nothing in `~/.config/kilo` is written, and every `kilo`
flag (including `-m`) forwards untouched. Kilo speaks `POST /v1/chat/completions` to the gateway,
with the same function tools OpenCode sends.

The gateway forwards to the Kilo Gateway (`https://api.kilo.ai/api/openrouter`), the backend of
Kilo's own `kilo` provider. That provider cannot be pointed at the gateway itself: it appends
`/openrouter/` to any base URL, so its requests would miss the routed endpoint. The launcher adds a
separate provider instead, so your Kilo sign-in (`kilo auth`) is not reused by it.

| Variable | Default | Meaning |
| --- | --- | --- |
| `KILO_API_KEY` | unset | Your Kilo key, forwarded untouched to the Kilo Gateway. Unset, Kilo sends no credential and the Kilo Gateway serves you anonymously, with free models |
| `JEV_KILO_MODEL` | `kilo-auto/free` | Model selected as `jev-gateway/<model>`, in the Kilo Gateway's naming (`anthropic/claude-sonnet-4`, ...) |
| `JEV_KILO_UPSTREAM_BASE_URL` | `https://api.kilo.ai/api/openrouter` | Where the gateway forwards Kilo traffic. Any OpenAI-compatible endpoint works; `KILO_API_KEY` is then the key sent to it |
| `JEV_KILO_PORT` | `8793` | Router port for Kilo |

**Whether `forced` helps depends on the model behind it.** The free models tried did not reliably
follow a forced `tool_choice`: `kilo-auto/free` routed to a model that ignored it, and
`nvidia/nemotron-3-super-120b-a12b:free` honoured it in a direct call but not in a Kilo session.
An ignored choice does no harm (the turn goes on as it would without the gateway), but it saves
nothing either. Choose a model that honours `tool_choice` with `JEV_KILO_MODEL`, and check the
dashboard.

`jev-kilo --print-config` prints the same provider as a `kilo.jsonc` snippet, to point plain `kilo`
at a gateway kept running with `jev-kilo --start`.

Run end to end with a real Kilo CLI, the real Kilo Gateway and the real Jev (TypeSafe), on
`kilo-auto/free`: Jev picked `read` twice and then `none`, each call in under half a second.

## Using it with Gemini

`jev-gemini` runs the Gemini CLI with `GOOGLE_GEMINI_BASE_URL` pointed at a gateway on port 8788,
which forwards to `https://generativelanguage.googleapis.com` (override with
`JEV_GEMINI_UPSTREAM_BASE_URL`). The gateway handles `POST /v1beta/models/<model>:generateContent`
and `:streamGenerateContent`, forces a tool through `toolConfig.functionCallingConfig`, and
proxies every other `/v1beta/*` path unchanged. Your API key travels as the client sent it, in the
`x-goog-api-key` header or the `key` query parameter.

This covers clients that use a **Gemini API key**. A Gemini CLI signed in with a Google account
talks to a different Google service and does not go through the gateway. The Gemini path has unit
tests but has not yet been run against the real API.

## Using it with Devin

`jev-devin` runs the Devin CLI with `WINDSURF_API_SERVER_URL` pointed at a gateway on port 8792,
which forwards to `https://server.codeium.com` (override with `JEV_DEVIN_UPSTREAM_BASE_URL`). The
variable's name is a leftover compiled into the `devin` binary — its inference backend is called
"windsurf" — and it is the only knob that redirects this traffic. `DEVIN_API_URL` points at a
different service (`api.devin.ai`, for auth and handoff) and is left alone.

Devin does not speak JSON REST. Its requests are Connect RPC envelopes carrying protobuf bodies,
so the gateway decodes `POST /exa.api_server_pb.ApiServerService/GetChatMessage` without a schema,
reads the messages and tools out of the wire fields, and re-encodes whatever it changed. There is
no `tool_choice` on this wire, so steering is always `hint` — a suggestion appended as one more
message — while `direct` synthesizes the Connect stream an upstream answer would have had. Every
other `exa.*` endpoint (seat management, model configuration, analytics) is proxied opaque. Token
usage is read back out of the stream's stats fields, so the dashboard meters Devin traffic like any
other client's.

Verified end to end on Devin CLI 3000.11.3: a `hint` rewrite was accepted upstream, a `direct`
answer was executed by the CLI, and the following turn — whose history carries the unsealed
synthetic call — was accepted, so the server does not enforce the `sealed` field on history.
`devin -p` and the interactive TUI share the same backend, so both go through the gateway. Other
versions were not tested; anything the decoder cannot read fails open to passthrough.

One safety net does not reach Devin. Elsewhere, when the upstream refuses a rewritten request with
400 or 422, the gateway sends the original instead. Connect streams report errors inside the
stream, after an HTTP 200, so a refused `hint` reaches Devin as a failed turn. Set
`JEV_ROUTING=off` or run `devin` directly if that happens.

## Running it as a server for your own app

Work from a checkout:

```bash
pnpm install
cp .env.example .env    # choose hosted Jev with a key, or JEV_PROVIDER=ollama for local Nimble
pnpm dev               # listens on http://localhost:8787
```

Keep an existing `.env` if you already configured it. Set `UPSTREAM_BASE_URL` for your app's LLM
provider when it differs from OpenAI. `OLLAMA_BASE_URL` selects the server for Nimble tool selection;
`UPSTREAM_BASE_URL` selects the provider that generates replies.

Then point your client at it:

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:8787/v1")  # your usual provider key still works
```

The gateway routes these endpoints and proxies every other path unchanged:

| Endpoint | API |
| --- | --- |
| `POST /v1/chat/completions` | OpenAI Chat Completions |
| `POST /v1/responses` | OpenAI Responses |
| `POST /v1/messages` | Anthropic Messages |
| `POST /v1beta/models/*` | Google Gemini API (`generateContent`, `streamGenerateContent`) |
| `POST /exa.api_server_pb.ApiServerService/GetChatMessage` | Devin CLI (Connect/protobuf) |

By default your client's own `Authorization` header is forwarded to the provider. Set
`UPSTREAM_API_KEY` to have the gateway hold the provider key instead, and `ROUTER_API_KEY` to
require a gateway key from clients. Any OpenAI-compatible provider works, for example OpenAI,
OpenRouter, vLLM, Ollama, or LiteLLM.

To skip tool selection for a single request, send the header `x-jev-gateway: off`.

### Try a decision without calling any LLM

`POST /router/decide` takes a request body, asks the configured tool-selection model, and returns
the decision: the mode, the tool, the arguments when available, confidence, and latency.
It calls hosted Jev or local Nimble but never sends the request to the upstream LLM. With
Nimble's default `JEV_DIRECT_CALLS=false`, a selected tool returns `forced` rather than filled
arguments; set `JEV_DIRECT_CALLS=true` to check closed-set argument filling.

```bash
curl -s localhost:8787/router/decide -H 'content-type: application/json' -d '{
  "model": "gpt-5",
  "messages": [{"role": "user", "content": "turn the kitchen lights on"}],
  "tools": [{"type": "function", "function": {
    "name": "set_lights", "description": "Turn the lights in a room on or off.",
    "parameters": {"type": "object", "required": ["room", "on"], "properties": {
      "room": {"type": "string", "enum": ["kitchen", "bedroom", "office"]},
      "on": {"type": "boolean"}}}}}]
}'
```

## How it works

The gateway turns tool selection into typed questions about the conversation. Hosted Jev answers
them together; local Nimble scores one answer token per question. Both return a tool choice and
confidence for the gateway to check. The work is split like this:

| Decision | Who makes it |
| --- | --- |
| Which tool, or no tool at all | The configured tool-selection model: Jev or Nimble |
| Arguments that are enums, booleans, or constants | The tool-selection model when `JEV_DIRECT_CALLS=true`; enabled by default for hosted Jev, disabled by default for Ollama |
| Open-ended arguments such as free text, numbers, and dates | The LLM, already pointed at the selected tool |
| Plain text replies, and any request without tools | The LLM, untouched |

A routable request with tools asks the configured model to classify the conversation. The
questions are: which tool (or none), whether a tool is needed at all (an independent cross-check),
and, when direct calls are enabled, the value of every closed-set argument. The answer selects a mode, which is reported in the
`x-jev-gateway-mode` response header:

| Mode | When | What happens |
| --- | --- | --- |
| `direct` | Direct calls are enabled, the routing model is confident about the tool and its closed-set arguments | The gateway builds the tool call itself, streaming included. **No LLM call.** Never with extended thinking on (Claude Code): the next turn would replay a tool call with no thinking block, which the API rejects, so such a request gets `hint` instead |
| `forced` | The routing model is confident about a tool and no direct answer is available | Forwarded with `tool_choice` set to that tool, so the LLM only fills in arguments. `ARGS_MODEL` can send these to a cheaper model |
| `hint` | The routing model is confident, but `tool_choice` cannot be changed (Anthropic with thinking on, or a cached conversation) | Forwarded with a one-line suggestion added after the client's last block, so cached prefixes stay valid |
| `none` | The routing model is confident that no tool is needed | Forwarded with `tool_choice: "none"` |
| `passthrough` | Low confidence, the two checks disagree, tool selection failed, there are no tools, or the caller already chose | Forwarded byte for byte. `x-jev-gateway-reason` says why |

Responses requests containing Codex `agent_message` items pass through without consulting the routing model,
with reason `agent_message`. These carry delegated tasks or replies that the router cannot
interpret and may contain encrypted content, so the model keeps control of tool selection.
Once an `agent_message` item is in the input, every later request in the same conversation carries
it. Passthrough therefore lasts for the rest of that conversation, so a subagent session is never
routed by Jev or Nimble.

With hosted Jev, tool lists longer than 120 entries (Claude Code sends about 280) take two calls.
The first ranks the list in groups. The second decides among the top 3 of each group, using fuller
descriptions. With local Nimble, shortlisting starts at 48 tools and uses a separate inference for
each group, then separate questions for the final choice and cross-check.

## Configuration

Settings are environment variables. The launchers read them from your shell,
`~/.jev-gateway/.env`, or a checkout's own `.env`. See [.env.example](.env.example) for the full
list. The ones worth knowing:

| Variable | Default | Meaning |
| --- | --- | --- |
| `TYPESAFE_API_KEY`, `OPENROUTER_API_KEY`, `AI_GATEWAY_API_KEY` or `OPENCODE_API_KEY` | required for hosted Jev | The key for Jev; local Ollama needs none |
| `JEV_PROVIDER` | whichever key is set | `typesafe`, `openrouter`, `vercel`, `opencode` or `ollama` |
| `JEV_MODEL` | provider default | For Ollama, the local model name; defaults to `nimble:latest` |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama server root for local tool selection |
| `JEV_URL` | provider endpoint | Overrides the full tool-selection endpoint; takes precedence over `OLLAMA_BASE_URL` |
| `JEV_MIN_CONFIDENCE` | `0.7` | Below this confidence, the LLM decides. Lower it to route more, raise it to be more careful |
| `JEV_ARG_MIN_CERTAINTY` | `0.8` | Every argument must reach this for a `direct` answer |
| `JEV_DIRECT_CALLS` | `true`; `false` for Ollama | Set to `false` so the gateway never answers without the LLM |
| `JEV_ROUTING` | `on` | Set to `off` to start in baseline mode |
| `JEV_TIMEOUT_MS` | `4000`; `30000` for Ollama | How long to wait for tool selection before letting the LLM decide |
| `JEV_MAX_STATE_CHARS` | `60000`; `12000` for Ollama | Conversation budget used to retain the newest turns |
| `JEV_MAX_MESSAGE_CHARS` | `4000`; `2000` for Ollama | Character limit for system instructions and individual message text |
| `ARGS_MODEL` | unset | A cheaper model for filling arguments in `forced` mode |
| `HOST` | `127.0.0.1` | Interface to listen on. Set `ROUTER_API_KEY` before exposing it |
| `JEV_DEBUG_DUMP_DIR` | unset | Write requests and response summaries to this folder. Credentials in headers are redacted; bodies are written whole, system prompts and conversation included, in files only you can read |

Each request also logs one JSON line to stdout, or to `~/.jev-gateway/<client>.log` under a launcher.

## Known trade-offs

- Hosted Jev adds a network call to every routed turn with tools. Expect roughly half a second to
  a second. Local Nimble adds inference on your machine; model loading and larger tool lists add
  latency, so measure it in the dashboard.
- The routing model picks **one** tool per turn. In `forced` mode the LLM can still call that tool several times
  in parallel, but it cannot mix different tools in the same turn.
- A wrong forced tool can derail a turn. If the model had nothing left to do and is forced to call
  a tool anyway, it may produce an incomplete reply and the agent will retry. Raise
  `JEV_MIN_CONFIDENCE` if you see this.
- In `hint` mode the LLM still does its own reasoning, so the gain is accuracy, not cost.
- Routing reads text only. Hosted Jev has a 32k-token window; local Nimble uses 8,192 tokens.
  Images become placeholders and long conversations keep their newest turns. Jev is most accurate
  in English; Nimble's checkpoint is also trained for English text.
- The default confidence thresholds are starting points. Use the dashboard and baseline mode to tune
  them for your own work.
- A gateway started by a launcher has no key of its own, because the one `Authorization` header a
  client sends belongs to its provider. Any process on your machine can therefore use it: to reach
  the provider with credentials of its own, and to ask the routing model through `/router/decide`
  (using your key for hosted Jev or your machine's resources for local Nimble).
  It is not reachable from other machines. A gateway you run as a server can require a key
  (`ROUTER_API_KEY`), and then `/health` says only that it is up.

## Benchmark

Is it worth it? [jev-gateway-bench](https://github.com/vinilana/jev-gateway-bench) measures that:
a real coding agent does the same task with routing on and off, the gateway meters every token,
and a hidden verifier scores the result. The tasks are about building, debugging and extending a
chess rules engine.

Results so far, from 120 agent sessions: six models, two chess tasks, five runs per mode, agents
run clean with no MCP servers or plugins. Medians with routing on, compared with the same model
without it:

| | Fixing bugs: output / input tokens / time | Adding a feature: output / input tokens / time |
| --- | ---: | ---: |
| GPT-6 Astra (Codex) | -57% / -7% / -39% | 0% / +2% / +8% |
| GPT-5.6 Sol (Codex) | -57% / -40% / -36% | -9% / -39% / -16% |
| GPT-5.6 Luna (Codex) | -12% / -10% / +10% | -14% / -51% / -14% |
| Fable 5.1 (Claude Code) | -13% / -19% / +6% | -24% / -27% / -26% |
| Opus 5 (Claude Code) | -7% / -22% / +2% | +22% / +61% / +83% |
| Sonnet 5 (Claude Code) | -41% / -48% / -25% | +9% / +16% / +37% |

Routing pays off when debugging, for every model. On the feature task it helped some models and
made Opus 5 and Sonnet 5 clearly worse, and GPT-5.6 Luna got cheaper but less often right (3 of 5
runs solved, against 5 of 5 without routing). Measure on your own work before trusting it: five
runs per cell is a small sample. The chart, the spread of the individual runs, the raw data, how
one run was caught copying from another, and how to run it yourself are in that repository.

A [separate 20-run OpenCode series](https://github.com/vinilana/jev-gateway-bench/tree/main/results/2026-09-23-opencode-opus-5-cliproxy-comparison)
used Opus 5 on the same tasks. With routing on, median output tokens fell by 62% and time by 79% on
the bugfix task; on the feature task, output tokens fell by 29% and time by 31%. All 20 runs passed
every hidden check. That series used forced tools through Chat Completions and a local CLI Proxy
API, while the Claude Code runs used hints through Anthropic Messages and a claude.ai
subscription. Gateway version, Jev provider, tool roster and run date differed too, so the
comparison does not isolate the harness as the cause. Five runs per cell is a small sample.

## Development

```bash
pnpm install
pnpm test         # runs against fake Jev and provider transports, no keys needed
pnpm typecheck
pnpm build
```

Pull requests are welcome and run the same checks in CI. [CONTRIBUTING.md](CONTRIBUTING.md) covers
running your changes, where things live in the code, how to add a wire format or a client
launcher, and what a pull request should contain.

`scripts/mock-jev.mjs` is a local stand-in for Jev. Point `TYPESAFE_BASE_URL` at it to drive a real
agent end to end without a TypeSafe key.

Releases are automatic: release-please keeps a release pull request open, and merging it publishes
to npm through trusted publishing, with no tokens involved. See [docs/releasing.md](docs/releasing.md).

## License

MIT
