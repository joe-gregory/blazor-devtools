import { ComponentDetector } from '@shared/detectors/component-detector';

// This runs in the context of the web page
const detector = new ComponentDetector();

// Listen for messages from the DevTools panel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'detectComponents') {
    const components = detector.detectComponents();
    // Convert Map to serializable format
    const componentsArray = Array.from(components.values());
    sendResponse({ components: componentsArray });
  }
});

// Notify that Blazor components are detected on this page
const hasBlazorMarkers = document.querySelector('[data-blazordevtools-marker]');
if (hasBlazorMarkers) {
  chrome.runtime.sendMessage({ blazorDetected: true });
}