# Jira Desktop

Electron desktop wrapper for Jira with a hardened remote-content shell and basic load/error handling.

## Run locally

```bash
yarn install
yarn start
```

## Configuration

- `JIRA_URL`
  Defaults to `https://c20y.atlassian.net`.
- `JIRA_ALLOWED_HOSTS`
  Optional comma-separated list of additional hosts allowed for top-level navigation or permission checks.
  Use this for SSO providers or custom Atlassian-adjacent domains if your login flow requires them.

## Packaging

```bash
yarn dist
```

The macOS build now uses a reduced entitlement set intended for a network-only Jira wrapper.
