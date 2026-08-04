try {
  const params = new URLSearchParams(window.location.search);
  const edition = params.get("edition") === "animus" ? "animus" : "standard";
  if (edition === "animus") {
    document.documentElement.dataset.appEdition = "animus";
    document.documentElement.dataset.appTheme = "dark";
    document.documentElement.style.colorScheme = "dark";
  } else {
    const snapshot = window.orc?.theme?.getSnapshot?.();
    const theme =
      snapshot?.resolved === "dark" || snapshot?.resolved === "light"
        ? snapshot.resolved
        : window.matchMedia?.("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    document.documentElement.dataset.appTheme = theme;
    document.documentElement.style.colorScheme = theme;
  }
} catch {
  document.documentElement.dataset.appTheme = "light";
  document.documentElement.style.colorScheme = "light";
}
