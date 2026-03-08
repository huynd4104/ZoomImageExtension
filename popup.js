document.addEventListener("DOMContentLoaded", () => {
    const toggleSwitch = document.getElementById("toggleSwitch");
    const statusText = document.getElementById("statusText");
    const galleryToggleSwitch = document.getElementById("galleryToggleSwitch");
    const galleryStatusText = document.getElementById("galleryStatusText");

    // Load initial state
    chrome.storage.local.get(["extension_enabled", "gallery_mode_enabled"], (result) => {
        let isEnabled = true; // Default to true
        if (result.extension_enabled !== undefined) {
            isEnabled = result.extension_enabled;
        }
        toggleSwitch.checked = isEnabled;
        statusText.innerText = isEnabled ? "ON" : "OFF";

        let isGalleryEnabled = true; // Default to true
        if (result.gallery_mode_enabled !== undefined) {
            isGalleryEnabled = result.gallery_mode_enabled;
        }
        galleryToggleSwitch.checked = isGalleryEnabled;
        galleryStatusText.innerText = isGalleryEnabled ? "ON" : "OFF";
    });

    // Handle toggle change
    toggleSwitch.addEventListener("change", () => {
        const isEnabled = toggleSwitch.checked;
        chrome.storage.local.set({ extension_enabled: isEnabled }, () => {
            statusText.innerText = isEnabled ? "ON" : "OFF";
        });
    });

    galleryToggleSwitch.addEventListener("change", () => {
        const isGalleryEnabled = galleryToggleSwitch.checked;
        chrome.storage.local.set({ gallery_mode_enabled: isGalleryEnabled }, () => {
            galleryStatusText.innerText = isGalleryEnabled ? "ON" : "OFF";
        });
    });
});
