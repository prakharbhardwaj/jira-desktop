# Contributing

## Development setup

```bash
yarn install
JIRA_URL=https://your-domain.atlassian.net yarn start
```

## Before opening a pull request

- Run `yarn test:smoke`
- Keep Electron security defaults intact unless there is a clear reason to change them
- Document any new environment variables in `README.md`

## Pull requests

- Keep changes scoped and focused
- Include testing notes in the PR description
- Call out any platform-specific behavior changes
