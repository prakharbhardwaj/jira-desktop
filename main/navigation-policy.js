const DEFAULT_ALLOWED_HOST_SUFFIXES = [
  ".atlassian.net",
  ".atlassian.com",
  ".jira.com",
  // Common identity providers used for Atlassian SSO. Without these, the
  // SAML/OIDC redirect lands in the external browser and the response
  // cannot make it back into the app's session.
  ".okta.com",
  ".oktapreview.com",
  ".onelogin.com",
  ".pingidentity.com",
  ".microsoftonline.com",
  ".auth0.com",
  ".github.com",
  ".gitlab.com",
  ".bitbucket.org",
  // Jira Marketplace apps that render their own UI / OAuth popups
  // (e.g. the "Issue Checklist" app served from checklist.appbox.ai).
  ".appbox.ai"
];

const DEFAULT_ALLOWED_HOSTS = ["accounts.google.com", "login.microsoftonline.com"];

function createNavigationPolicy({ Menu, clipboard, shell, getConfig, getMainWindow, onOpenAllowedLink }) {
  const configuredSessions = new WeakSet();

  function currentConfig() {
    return getConfig() || { jiraHost: "", allowedHosts: new Set() };
  }

  function isConfiguredHost(hostname) {
    const config = currentConfig();

    if (!config.jiraHost) {
      return false;
    }

    const normalizedHost = hostname.toLowerCase();

    if (normalizedHost === config.jiraHost || config.allowedHosts.has(normalizedHost)) {
      return true;
    }

    // Match both subdomains (".github.com") and the apex itself ("github.com").
    // GitHub/GitLab/Bitbucket OAuth flows (used by Jira's "Create branch") land
    // on the apex domain, which would otherwise fail the endsWith suffix test.
    return DEFAULT_ALLOWED_HOST_SUFFIXES.some((suffix) => {
      const apex = suffix.startsWith(".") ? suffix.slice(1) : suffix;

      return normalizedHost === apex || normalizedHost.endsWith(suffix);
    });
  }

  function isAllowedNavigation(targetUrl) {
    try {
      const parsedUrl = new URL(targetUrl);

      return parsedUrl.protocol === "https:" && isConfiguredHost(parsedUrl.hostname);
    } catch {
      return false;
    }
  }

  function isAllowedPermission(permission, origin) {
    if (permission === "clipboard-sanitized-write" || permission === "clipboard-read") {
      return isAllowedNavigation(origin || "");
    }

    return permission === "notifications" && isAllowedNavigation(origin || "");
  }

  function configureSession(session) {
    if (configuredSessions.has(session)) {
      return;
    }

    configuredSessions.add(session);

    session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
      callback(isAllowedPermission(permission, details.requestingUrl || ""));
    });

    session.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
      return isAllowedPermission(permission, requestingOrigin || "");
    });
  }

  function handleContextMenu(_webContents, params) {
    const mainWindow = getMainWindow();

    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    const template = [];
    const hasEditableActions =
      params.isEditable || params.editFlags.canCopy || params.editFlags.canPaste || params.editFlags.canCut || params.editFlags.canSelectAll;

    if (params.linkURL) {
      if (isAllowedNavigation(params.linkURL)) {
        template.push({
          label: "Open Link in New Tab",
          click: () => {
            onOpenAllowedLink(params.linkURL);
          }
        });
      }

      template.push(
        {
          label: "Open Link Externally",
          click: () => {
            void shell.openExternal(params.linkURL);
          }
        },
        {
          label: "Copy Link",
          click: () => {
            clipboard.writeText(params.linkURL);
          }
        }
      );
    }

    if (params.selectionText && params.editFlags.canCopy) {
      template.push({
        label: "Copy",
        role: "copy"
      });
    }

    if (hasEditableActions) {
      if (template.length > 0) {
        template.push({ type: "separator" });
      }

      template.push(
        {
          label: "Undo",
          role: "undo",
          enabled: params.editFlags.canUndo
        },
        {
          label: "Redo",
          role: "redo",
          enabled: params.editFlags.canRedo
        },
        { type: "separator" },
        {
          label: "Cut",
          role: "cut",
          enabled: params.isEditable && params.editFlags.canCut
        },
        {
          label: "Copy",
          role: "copy",
          enabled: params.editFlags.canCopy
        },
        {
          label: "Paste",
          role: "paste",
          enabled: params.isEditable && params.editFlags.canPaste
        },
        {
          label: "Select All",
          role: "selectAll",
          enabled: params.editFlags.canSelectAll
        }
      );
    }

    if (template.length === 0) {
      return;
    }

    const popupOptions = {
      window: mainWindow,
      x: params.x,
      y: params.y
    };

    if (params.frame) {
      popupOptions.frame = params.frame;
    }

    if (process.platform !== "darwin" && params.menuSourceType) {
      popupOptions.sourceType = params.menuSourceType;
    }

    Menu.buildFromTemplate(template).popup(popupOptions);
  }

  return {
    configureSession,
    handleContextMenu,
    isAllowedNavigation,
    isConfiguredHost
  };
}

module.exports = {
  DEFAULT_ALLOWED_HOST_SUFFIXES,
  createNavigationPolicy
};
