# Jira Desktop

Jira Desktop is a lightweight Electron client for Jira. It wraps your Jira workspace in a hardened desktop shell, supports multiple tabs, and keeps remote content isolated from the local UI layer.

## Features

- Multi-tab Jira browsing inside a single desktop window
- Hardened Electron configuration with `contextIsolation`, `sandbox`, and disabled `nodeIntegration`
- Navigation restricted to Jira and approved Atlassian-adjacent hosts
- Basic loading and error states for failed network loads
- Smoke test coverage for the desktop shell

## Screenshots

### Setup screen

![Jira Desktop setup screen](./assets/screenshots/setup-screen.png)

### Network error state

![Jira Desktop network error state](./assets/screenshots/error-state.png)

## Requirements

- Node.js 20 or later
- Yarn 1.x
- A Jira Cloud workspace URL such as `https://your-domain.atlassian.net`

## Run locally

```bash
yarn install
JIRA_URL=https://your-domain.atlassian.net yarn start
```

You can also pass the workspace URL on the command line:

```bash
yarn start -- --jira-url=https://your-domain.atlassian.net
```

If no Jira URL is configured, the app stays on a setup screen instead of opening a hardcoded tenant.

## Configuration

### `JIRA_URL`

Required. The Jira workspace to open.

### `JIRA_ALLOWED_HOSTS`

Optional comma-separated list of additional hosts that should be allowed for top-level navigation or notification permission checks. This is useful for SSO providers or Jira-adjacent domains that participate in your login flow.

Example:

```bash
JIRA_URL=https://your-domain.atlassian.net \
JIRA_ALLOWED_HOSTS=auth.example.com,id.atlassian.com \
yarn start
```

## Scripts

```bash
yarn start
yarn test:smoke
yarn pack
yarn dist
```

## Packaging

Production packaging is handled by `electron-builder`.

```bash
yarn dist
```

The macOS build uses a reduced entitlement set intended for a network-only Jira wrapper.

## GitHub Releases

The repository includes a GitHub Actions workflow at `.github/workflows/release.yml`.

- Push a tag such as `v1.0.1` to build macOS and Windows artifacts and publish a GitHub Release
- The tag must match the `version` field in `package.json`
- You can also run the workflow manually and optionally provide an existing release tag

## Open Source Notes

- The project is MIT licensed. See `LICENSE`.
- Local build artifacts, logs, and machine-specific files are ignored via `.gitignore`.
- Before publishing your GitHub repository, update `package.json` repository metadata if you want package links to point at the final repo URL.

## Contributing

Contributions are welcome. See `CONTRIBUTING.md` for setup and contribution expectations.
