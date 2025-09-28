// Background service worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.blazorDetected) {
    // Enable the DevTools panel for this tab
    if (sender.tab?.id) {
      chrome.action.setIcon({
        tabId: sender.tab.id,
        path: {
          "16": "assets/icon-active-16.png",
          "48": "assets/icon-active-48.png"
        }
      });
    }
  }
});