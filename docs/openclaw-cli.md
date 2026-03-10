🦞 OpenClaw 2026.3.8 (3caab92) — I'll butter your workflow like a lobster roll: messy, delicious, effective.

Usage: openclaw [options] [command]

Options:
  --dev                Dev profile: isolate state under ~/.openclaw-dev, default gateway port 19001, and shift derived ports
                       (browser/canvas)
  -h, --help           Display help for command
  --log-level <level>  Global log level override for file + console (silent|fatal|error|warn|info|debug|trace)
  --no-color           Disable ANSI colors
  --profile <name>     Use a named profile (isolates OPENCLAW_STATE_DIR/OPENCLAW_CONFIG_PATH under ~/.openclaw-<name>)
  -V, --version        output the version number

Commands:
  Hint: commands suffixed with * have subcommands. Run <command> --help for details.
  acp *                Agent Control Protocol tools
  agent                Run one agent turn via the Gateway
  agents *             Manage isolated agents (workspaces, auth, routing)
  approvals *          Manage exec approvals (gateway or node host)
  backup *             Create and verify local backup archives for OpenClaw state
  browser *            Manage OpenClaw's dedicated browser (Chrome/Chromium)
  channels *           Manage connected chat channels (Telegram, Discord, etc.)
  clawbot *            Legacy clawbot command aliases
  completion           Generate shell completion script
  config *             Non-interactive config helpers (get/set/unset/file/validate). Default: starts setup wizard.
  configure            Interactive setup wizard for credentials, channels, gateway, and agent defaults
  cron *               Manage cron jobs via the Gateway scheduler
  daemon *             Gateway service (legacy alias)
  dashboard            Open the Control UI with your current token
  devices *            Device pairing + token management
  directory *          Lookup contact and group IDs (self, peers, groups) for supported chat channels
  dns *                DNS helpers for wide-area discovery (Tailscale + CoreDNS)
  docs                 Search the live OpenClaw docs
  doctor               Health checks + quick fixes for the gateway and channels
  gateway *            Run, inspect, and query the WebSocket Gateway
  health               Fetch health from the running gateway
  help                 Display help for command
  hooks *              Manage internal agent hooks
  logs                 Tail gateway file logs via RPC
  memory *             Search and reindex memory files
  message *            Send, read, and manage messages
  models *             Discover, scan, and configure models
  node *               Run and manage the headless node host service
  nodes *              Manage gateway-owned node pairing and node commands
  omoc-setup           Inject OmOC agent definitions into your OpenClaw config
  onboard              Interactive onboarding wizard for gateway, workspace, and skills
  pairing *            Secure DM pairing (approve inbound requests)
  plugins *            Manage OpenClaw plugins and extensions
  qr                   Generate iOS pairing QR/setup code
  reset                Reset local config/state (keeps the CLI installed)
  sandbox *            Manage sandbox containers for agent isolation
  secrets *            Secrets runtime reload controls
  security *           Security tools and local config audits
  sessions *           List stored conversation sessions
  setup                Initialize local config and agent workspace
  skills *             List and inspect available skills
  status               Show channel health and recent session recipients
  system *             System events, heartbeat, and presence
  tui                  Open a terminal UI connected to the Gateway
  uninstall            Uninstall the gateway service + local data (CLI remains)
  update *             Update OpenClaw and inspect update channel status
  webhooks *           Webhook helpers and integrations

Examples:
  openclaw models --help
    Show detailed help for the models command.
  openclaw channels login --verbose
    Link personal WhatsApp Web and show QR + connection logs.
  openclaw message send --target +15555550123 --message "Hi" --json
    Send via your web session and print JSON result.
  openclaw gateway --port 18789
    Run the WebSocket Gateway locally.
  openclaw --dev gateway
    Run a dev Gateway (isolated state/config) on ws://127.0.0.1:19001.
  openclaw gateway --force
    Kill anything bound to the default gateway port, then start it.
  openclaw gateway ...
    Gateway control via WebSocket.
  openclaw agent --to +15555550123 --message "Run summary" --deliver
    Talk directly to the agent using the Gateway; optionally send the WhatsApp reply.
  openclaw message send --channel telegram --target @mychat --message "Hi"
    Send via your Telegram bot.

Docs: docs.openclaw.ai/cli
