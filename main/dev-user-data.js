const crypto = require("crypto");
const path = require("path");

function getDevUserDataPath({ appDataPath, appPath = "", configDirectory = "" }) {
  const scope = (configDirectory || appPath || "default").trim();
  const scopeHash = crypto.createHash("sha256").update(scope).digest("hex").slice(0, 12);

  return path.join(appDataPath, "Jira Desktop Dev", scopeHash);
}

module.exports = {
  getDevUserDataPath
};
