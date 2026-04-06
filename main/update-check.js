function normalizeVersion(value) {
  return String(value || "").replace(/^v/, "");
}

function compareVersions(latest, current) {
  const a = normalizeVersion(latest).split(".").map(Number);
  const b = normalizeVersion(current).split(".").map(Number);

  for (let i = 0; i < 3; i += 1) {
    if ((a[i] || 0) > (b[i] || 0)) {
      return true;
    }

    if ((a[i] || 0) < (b[i] || 0)) {
      return false;
    }
  }

  return false;
}

function pickFirstAsset(assets, matchers) {
  for (const matcher of matchers) {
    const asset = assets.find((candidate) => matcher.test(candidate.name || ""));

    if (asset) {
      return asset;
    }
  }

  return null;
}

function selectReleaseAsset(assets, platform, arch) {
  if (!Array.isArray(assets) || assets.length === 0) {
    return null;
  }

  if (platform === "darwin") {
    const preferredMatchers = arch === "arm64"
      ? [/arm64\.zip$/i, /arm64\.dmg$/i, /\.zip$/i, /\.dmg$/i]
      : [/x64\.zip$/i, /x64\.dmg$/i, /\.zip$/i, /\.dmg$/i];

    return pickFirstAsset(assets, preferredMatchers);
  }

  if (platform === "win32") {
    const preferredMatchers = arch === "arm64"
      ? [/arm64\.exe$/i, /arm64\.zip$/i, /\.exe$/i, /\.zip$/i]
      : [/x64\.exe$/i, /x64\.zip$/i, /\.exe$/i, /\.zip$/i];

    return pickFirstAsset(assets, preferredMatchers);
  }

  return null;
}

function getUpdatePayload(release, currentVersion, platform, arch) {
  const latestVersion = normalizeVersion(release && release.tag_name);

  if (!latestVersion || !compareVersions(latestVersion, currentVersion)) {
    return { available: false };
  }

  const asset = selectReleaseAsset(release.assets || [], platform, arch);

  return {
    available: true,
    version: latestVersion,
    changelogUrl: release.html_url || "",
    downloadUrl: asset ? asset.browser_download_url || "" : "",
    downloadName: asset ? asset.name || "" : ""
  };
}

module.exports = {
  compareVersions,
  getUpdatePayload,
  selectReleaseAsset
};
