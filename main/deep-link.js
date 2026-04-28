const SUPPORTED_PROTOCOL = "jira-desktop";
const PROTOCOL_PREFIX = `${SUPPORTED_PROTOCOL}://`;

function tryParse(candidate) {
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

function parseDeepLink(input) {
  if (typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = tryParse(trimmed);

  if (!parsed) {
    return null;
  }

  if (parsed.protocol === "https:") {
    return parsed.toString();
  }

  if (parsed.protocol !== `${SUPPORTED_PROTOCOL}:`) {
    return null;
  }

  const queryUrl = parsed.searchParams.get("url");

  if (queryUrl) {
    const queryCandidate = tryParse(queryUrl);

    if (queryCandidate && queryCandidate.protocol === "https:") {
      return queryCandidate.toString();
    }
  }

  const remainder = trimmed.slice(PROTOCOL_PREFIX.length).replace(/^\/+/, "");

  if (remainder.startsWith("https://")) {
    const candidate = tryParse(remainder);

    if (candidate && candidate.protocol === "https:") {
      return candidate.toString();
    }
  }

  return null;
}

function findDeepLinkInArgv(argv) {
  if (!Array.isArray(argv)) {
    return null;
  }

  for (const arg of argv) {
    if (typeof arg !== "string") {
      continue;
    }

    if (!arg.startsWith(PROTOCOL_PREFIX) && !arg.startsWith("https://")) {
      continue;
    }

    const parsed = parseDeepLink(arg);

    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function createDeepLinkRouter({ isAllowedNavigation, createTab }) {
  function route(incomingUrl) {
    const parsed = parseDeepLink(incomingUrl);

    if (!parsed) {
      return { ok: false, reason: "invalid" };
    }

    if (!isAllowedNavigation(parsed)) {
      return { ok: false, reason: "not-allowed" };
    }

    const tab = createTab(parsed, { activate: true });

    return { ok: true, url: parsed, tabId: tab ? tab.id : null };
  }

  return { route };
}

module.exports = {
  PROTOCOL_PREFIX,
  SUPPORTED_PROTOCOL,
  createDeepLinkRouter,
  findDeepLinkInArgv,
  parseDeepLink
};
