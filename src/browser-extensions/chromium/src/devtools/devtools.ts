// Initialize the Blazor DevTools panel
chrome.devtools.panels.create(
  "Blazor",
  "assets/icon-16.png",
  "panel.html",
  (panel) => {
    console.log("Blazor DevTools panel created");
  }
);