// src/background.js

// Context menu setup
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "save-in",
        title: "Save In",
        contexts: ["selection"]
    });
});

// Handle context menu click event
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "save-in") {
        const selectedText = info.selectionText;
        saveSelectedText(selectedText);
    }
});

// Function to save selected text using Chrome's storage API
function saveSelectedText(text) {
    chrome.storage.local.get({ savedTexts: [] }, (result) => {
        const savedTexts = result.savedTexts;
        savedTexts.push(text);
        chrome.storage.local.set({ savedTexts: savedTexts }, () => {
            console.log("Text saved:", text);
            // You can implement download functionality here if needed
        });
    });
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getSavedTexts") {
        chrome.storage.local.get({ savedTexts: [] }, (result) => {
            sendResponse(result.savedTexts);
        });
        return true; // Keep the message channel open for sendResponse
    }
});

// Download functionality (optional depending on requirements)
function downloadFile(fileName, content) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);

    chrome.downloads.download({
        url: url,
        filename: fileName,
        saveAs: true
    }, (downloadId) => {
        console.log("Download initiated with ID:", downloadId);
    });
}