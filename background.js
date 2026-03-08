const contextMenuId = "magnify-image";

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        title: "Magnify image",
        contexts: ["all"],
        id: contextMenuId,
    });
    chrome.contextMenus.create({
        title: "Gallery Mode (Collect all images)",
        contexts: ["all"],
        id: "magnify-gallery-mode",
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === contextMenuId) {
        chrome.tabs.sendMessage(tab.id, {
            action: "magnify_image_from_context",
            details: info
        }).catch(err => console.log("Error:", err));
    } else if (info.menuItemId === "magnify-gallery-mode") {
        chrome.tabs.sendMessage(tab.id, {
            action: "magnify_gallery_mode"
        }).catch(err => console.log("Error:", err));
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fetch_image_base64") {
        fetch(request.url)
            .then(res => res.blob())
            .then(blob => {
                const reader = new FileReader();
                reader.onloadend = () => sendResponse({ dataUrl: reader.result });
                reader.readAsDataURL(blob);
            })
            .catch(err => {
                console.error("Fetch image error", err);
                sendResponse({ error: err.toString() });
            });
        return true;
    }
});
