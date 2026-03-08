// Polyfills & Helpers
let extensionEnabled = true;
let galleryModeEnabled = true;

const CACHED = {
    mouse: { x: 0, y: 0 },
    configSize: [20, 20], // default minimum hover width/height
};

// Listen to changes in toggle switch
chrome.storage.local.get(["extension_enabled", "gallery_mode_enabled"], (result) => {
    if (result.extension_enabled !== undefined) {
        extensionEnabled = result.extension_enabled;
    }
    if (result.gallery_mode_enabled !== undefined) {
        galleryModeEnabled = result.gallery_mode_enabled;
    }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local") {
        if (changes.extension_enabled) {
            extensionEnabled = changes.extension_enabled.newValue;
            // Realtime hide hover icon if disabled
            if (!extensionEnabled) {
                let div = document.getElementById("ufs-magnify-image-hover-div");
                if (div) {
                    div.classList.toggle("hide", true);
                }
            }
        }
        if (changes.gallery_mode_enabled) {
            galleryModeEnabled = changes.gallery_mode_enabled.newValue;
        }
    }
});

const MagnifySizeKey = "ufs_magnify_image_size";
const getConfigSize = async () => {
    return new Promise((resolve) => {
        chrome.storage.local.get([MagnifySizeKey], (result) => {
            let data = result[MagnifySizeKey];
            if (data) {
                CACHED.configSize = data.split("x");
            }
            resolve(CACHED.configSize);
        });
    });
};

function getMousePos() {
    return CACHED.mouse;
}

function validateMouse(x, y) {
    if (x == null || y == null) {
        let mouse = getMousePos();
        return {
            x: mouse.x ?? x ?? 0,
            y: mouse.y ?? y ?? 0,
        };
    }
    return { x, y };
}

// Simple notify replacement using standard DOM
function notify({ msg, duration = 3000, x = window.innerWidth / 2, y = window.innerHeight - 100 }) {
    let id = "ufs_notify_div";
    let exist = document.getElementById(id);
    if (exist) exist.remove();

    let div = document.createElement("div");
    div.id = id;
    div.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      padding: 10px;
      background-color: #333;
      color: #fff;
      border-radius: 5px;
      z-index: 2147483647;
      transition: all 1s ease-out;
      transform: translateX(-50%);
    `;
    div.innerText = msg;
    (document.body || document.documentElement).appendChild(div);

    const timeout = setTimeout(() => {
        if (div) {
            div.style.opacity = 0;
            div.style.top = `${y - 50}px`;
            setTimeout(() => div.remove(), 1000);
        }
    }, duration);

    return {
        remove() { div?.remove(); },
        setText(text) { if (div) div.innerText = text; },
        closeAfter(time) {
            setTimeout(() => {
                if (div) {
                    div.style.opacity = 0;
                    div.style.top = `${y - 50}px`;
                    setTimeout(() => div.remove(), 1000);
                }
            }, time);
        }
    };
}

// ===================== Image source extraction =====================

const lazyImgAttr = [
    "src", "_src", "xlink:href", "data-lazy-src", "org_src", "data-lazy",
    "data-url", "data-orig-file", "zoomfile", "file", "original", "load-src",
    "imgsrc", "real_src", "src2", "origin-src", "data-lazyload",
    "data-lazyload-src", "data-lazy-load-src", "data-ks-lazyload",
    "data-ks-lazyload-custom", "data-src", "data-defer-src", "data-actualsrc",
    "data-cover", "data-original", "data-thumb", "data-imageurl", "data-placeholder", "lazysrc"
];

function relativeUrlToAbsolute(url) {
    try {
        return new URL(url, location.href).href;
    } catch (e) {
        return url;
    }
}

function getBg(node) {
    if (!node || node.nodeName?.toUpperCase?.() == "HTML" || node.nodeName == "#document") {
        return false;
    }
    return ["", "::before", "::after"]
        .map((s) => {
            let nodeStyle = window.getComputedStyle(node, s);
            let bg = nodeStyle.backgroundImage;
            if (bg && bg !== "none") {
                let bgUrls = bg.split(",");
                let urls = bgUrls.map((url) => url.match(/url\((['"]?)(.*?)\1\)/)?.[2]);
                return urls.filter((url) => url !== null);
            }
            return null;
        })
        .flat()
        .filter((_) => _);
}

function getLargestSrcset(srcset) {
    let srcs = srcset.split(/[xw],/i), largeSize = -1, largeSrc = null;
    if (!srcs.length) return null;
    srcs.forEach((srci) => {
        let srcInfo = srci.trim().split(/(\s+|%20)/), curSize = parseInt(srcInfo[2] || 0);
        if (srcInfo[0] && curSize > largeSize) {
            largeSize = curSize;
            largeSrc = srcInfo[0];
        }
    });
    return largeSrc;
}

function getImgSrcsFromElement(ele) {
    if (!ele) return null;

    let fn = [
        () => {
            let srcset = ele.srcset || ele.getAttribute("srcset");
            if (!srcset && ele.children?.length) {
                for (let i = 0; i < ele.children.length; i++) {
                    let _ = ele.children[i].srcset || ele.children[i].getAttribute("srcset");
                    if (_) srcset = (srcset ? srcset + ", " : "") + _;
                }
            }
            if (!srcset) return;
            return getLargestSrcset(srcset);
        },
        () => {
            for (let i in lazyImgAttr) {
                let attrValue = ele.getAttribute(lazyImgAttr[i]);
                if (attrValue && !/\bimagecover\.\w+$/i.test(attrValue)) {
                    return attrValue;
                }
            }
        },
        () => getBg(ele),
        () => {
            if (/image/i.test(ele.tagName)) return ele.getAttribute("href");
            if (/canvas/i.test(ele.tagName)) return ele.toDataURL();
            if (/video/i.test(ele.tagName)) {
                let canvas = document.createElement("canvas");
                canvas.width = ele.videoWidth;
                canvas.height = ele.videoHeight;
                canvas.getContext("2d").drawImage(ele, 0, 0);
                return canvas.toDataURL();
            }
        },
    ];

    let results = [];
    for (let f of fn) {
        try {
            let srcs = f();
            if (srcs && srcs?.length) {
                if (!Array.isArray(srcs)) srcs = [srcs];
                results = results.concat(srcs.filter(s => s).map((src) => relativeUrlToAbsolute(src)));
            }
        } catch (e) { }
    }
    return results;
}

function getAllChildElements(element) {
    let childElements = [];
    let children = element.children;
    if (children?.length) {
        childElements = childElements.concat(Array.from(children));
        for (let child of children) {
            childElements = childElements.concat(getAllChildElements(child));
        }
    }
    return childElements;
}

async function getImagesAtPos(x, y) {
    let eles = Array.from(document.querySelectorAll("*"));
    let pos = validateMouse(x, y);
    let sourceEles = [];

    eles = eles.reverse().filter((ele) => {
        let rect = ele.getBoundingClientRect();
        let isAtMouse = rect.left <= pos.x && rect.right >= pos.x && rect.top <= pos.y && rect.bottom >= pos.y;
        if (isAtMouse && /picture|img/i.test(ele.tagName)) {
            let sources = Array.from(ele.querySelectorAll("source"));
            if (sources?.length) sourceEles = sourceEles.concat(sources);
        }
        return isAtMouse;
    });

    eles = eles.concat(sourceEles);
    eles = eles.concat(eles.slice(0, 4).map((ele) => getAllChildElements(ele)).flat());

    if (!eles.length) return null;

    let results = [];
    for (let ele of eles) {
        let srcs = getImgSrcsFromElement(ele);
        if (srcs && srcs?.length) {
            if (!Array.isArray(srcs)) srcs = [srcs];
            srcs.forEach((src) => {
                if (!results.find((r) => r.src == src)) results.push({ src, ele });
            });
        }
    }

    if (results.length > 1) {
        let rank = [/source/i, /img/i, /picture/i, /image/i, /a/i];
        results = results.sort((a, b) => {
            let rankA = rank.findIndex((r) => r.test(a.src));
            let rankB = rank.findIndex((r) => r.test(b.src));
            rankA = rankA == -1 ? 100 : rankA;
            rankB = rankB == -1 ? 100 : rankB;
            return rankB - rankA;
        });
    }

    results = results.filter(({ ele }) => !/iframe/i.test(ele.tagName));
    return results;
}

// ===================== Hover & Ctrl Support =====================

function getContentClientRect(target, win = window) {
    let rect = target.getBoundingClientRect();
    let compStyle = win.getComputedStyle(target);
    let pFloat = parseFloat;
    let top = rect.top + pFloat(compStyle.paddingTop) + pFloat(compStyle.borderTopWidth);
    let right = rect.right - pFloat(compStyle.paddingRight) - pFloat(compStyle.borderRightWidth);
    let bottom = rect.bottom - pFloat(compStyle.paddingBottom) - pFloat(compStyle.borderBottomWidth);
    let left = rect.left + pFloat(compStyle.paddingLeft) + pFloat(compStyle.borderLeftWidth);
    return { top, right, bottom, left, width: right - left, height: bottom - top };
}

function onDoublePress(key, callback, timeout = 500) {
    let timer = null;
    let clickCount = 0;
    const keyup = (event) => {
        if (event.key !== key) {
            clickCount = 0;
            return;
        }
        clickCount++;
        if (clickCount === 2) {
            callback?.();
            clickCount = 0;
            return;
        }
        clearTimeout(timer);
        timer = setTimeout(() => { clickCount = 0; }, timeout);
    };
    document.addEventListener("keyup", keyup);
    return () => { clearTimeout(timer); document.removeEventListener("keyup", keyup); };
}

function initHoverAndCtrl() {
    window.addEventListener("mousemove", (e) => {
        CACHED.mouse.x = e.clientX;
        CACHED.mouse.y = e.clientY;
    });

    let hovering = null;
    let div = document.createElement("div");
    div.id = "ufs-magnify-image-hover-div";
    div.title = "Click to magnify";
    div.addEventListener("click", () => {
        if (hovering) {
            window.top.postMessage(
                {
                    type: "ufs-magnify-image-hover",
                    data: { srcs: hovering?.srcs, x: hovering?.rect?.left, y: hovering?.rect?.top }
                }, "*"
            );
        }
    });

    (document.body || document.documentElement).appendChild(div);

    window.addEventListener("mouseover", async (e) => {
        if (!extensionEnabled) return;
        const [width, height] = await getConfigSize();
        if (e.target.clientWidth < width || e.target.clientHeight < height) return;

        let srcs = getImgSrcsFromElement(e.target);
        if (!srcs?.length) {
            div.classList.toggle("hide", e.target !== div);
            return;
        }

        let rect = getContentClientRect(e.target);
        if (rect.width < 30 || rect.height < 30) {
            rect.top -= rect.width / 2;
            rect.left -= rect.height / 2;
        }
        rect.left = Math.max(rect.left, 0);
        rect.top = Math.max(rect.top, 0);

        hovering = { srcs, rect, target: e.target };
        div.style.left = rect.left + "px";
        div.style.top = rect.top + "px";
        div.classList.toggle("hide", false);
    });

    if (window === window.top) {
        onDoublePress("Control", () => {
            if (!extensionEnabled) return;

            // Check if any overlay is already open, if so, close them
            let chooseImgOverlay = document.getElementById("ufs-magnify-choose-image");
            let previewOverlay = document.getElementById("ufs-magnify-image");
            let closedAny = false;

            if (previewOverlay) {
                previewOverlay.click();
                if (document.getElementById("ufs-magnify-image")) previewOverlay.remove();
                closedAny = true;
            }

            if (chooseImgOverlay) {
                chooseImgOverlay.click();
                if (document.getElementById("ufs-magnify-choose-image")) chooseImgOverlay.remove();
                closedAny = true;
            }

            if (closedAny) return;

            let mouse = getMousePos();
            magnifyImage(mouse.x, mouse.y);
        });

        onDoublePress("Shift", () => {
            if (!extensionEnabled || !galleryModeEnabled) return;
            let id = "ufs-gallery-mode-overlay";
            let overlay = document.getElementById(id);
            if (overlay) {
                overlay.remove();
            } else {
                openGalleryMode();
            }
        });

        window.addEventListener("message", (e) => {
            const { data, type } = e.data || {};
            if (type === "ufs-magnify-image-hover") {
                let srcs = data?.srcs;
                if (srcs?.length > 1) chooseImg(srcs, data.x, data.y);
                else if (srcs?.length === 1) createPreview(srcs[0], data.x, data.y);
            }
        });
    }
}

// ===================== Magnify Logic =====================

function magnifyImage(x, y) {
    let mouse = validateMouse(x, y);

    getImagesAtPos(x, y).then((imgs) => {
        if (!imgs?.length) {
            notify({ msg: "No image found", x: mouse.x, y: mouse.y, align: "left" });
        } else if (imgs?.length === 1) {
            createPreview(imgs[0].src, mouse.x, mouse.y);
        } else {
            chooseImg(imgs.map((img) => img.src), mouse.x, mouse.y);
        }
    });
}

function resizeToFitWithMinSize(curW, curH, maxW, maxH, minSize) {
    const aspectRatio = curW / curH;
    let newWidth = maxW;
    let newHeight = maxW / aspectRatio;

    if (newHeight > maxH) {
        newHeight = maxH;
        newWidth = maxH * aspectRatio;
    }
    if (newWidth > maxW) {
        newWidth = maxW;
        newHeight = maxW / aspectRatio;
    }
    if (newWidth < minSize) {
        newWidth = minSize;
        newHeight = minSize / aspectRatio;
    }
    if (newHeight < minSize) {
        newHeight = minSize;
        newWidth = minSize * aspectRatio;
    }
    return { width: newWidth, height: newHeight };
}

const BgState = { none: "none", transparent: "transparent", dark: "dark", light: "light" };

function chooseImg(srcs, _x, _y) {
    let { x, y } = validateMouse(_x, _y);
    let id = "ufs-magnify-choose-image";
    if (document.getElementById(id)) document.getElementById(id).remove();

    let overlay = document.createElement("div");
    overlay.id = id;
    overlay.style.cssText = `top: ${y}px; left: ${x}px;`;
    overlay.onclick = (e) => {
        e.preventDefault();
        if (e.target == overlay || e.target == container) overlay.remove();
    };
    document.body.appendChild(overlay);

    let toolbar = document.createElement("div");
    toolbar.classList.add("ufs-toolbar");
    overlay.appendChild(toolbar);

    let bgStates = [BgState.none, BgState.dark, BgState.light];
    let curBgState = (Number(localStorage.getItem("ufs-magnify-image-bg-choose-image")) || 0) - 1;
    let toggleBg = document.createElement("div");
    toggleBg.classList.add("ufs-btn");
    toggleBg.innerText = "B";
    toggleBg.ufs_title = "Change background";
    toggleBg.onclick = () => {
        curBgState = (curBgState + 1) % bgStates.length;
        overlay.style.background = "";
        if (bgStates[curBgState] === BgState.none) overlay.style.background = "#000b";
        else if (bgStates[curBgState] === BgState.dark) overlay.style.background = "rgba(30, 30, 30, 1)";
        else if (bgStates[curBgState] === BgState.light) overlay.style.background = "rgba(240, 240, 240, 1)";
        toggleBg.innerText = "BG " + bgStates[curBgState];
        localStorage.setItem("ufs-magnify-image-bg-choose-image", curBgState);
    };
    toggleBg.click();
    toolbar.appendChild(toggleBg);

    let desc = document.createElement("div");
    desc.classList.add("ufs-desc");
    desc.innerText = "Choose image";
    toolbar.appendChild(desc);

    setTimeout(() => {
        overlay.style.top = 0; overlay.style.left = 0;
        overlay.style.width = "100vw"; overlay.style.height = "100vh";
        overlay.style.opacity = 1; overlay.style.borderRadius = "0";
    }, 0);

    let container = document.createElement("div");
    container.classList.add("ufs-img-container");

    let imgs = [];
    for (let i = 0; i < srcs.length; i++) {
        let src = srcs[i];
        let con = document.createElement("div");
        con.classList.add("ufs-con");
        container.appendChild(con);

        let size = document.createElement("div");
        size.classList.add("ufs-size");
        con.appendChild(size);

        let img = document.createElement("img");
        img.src = src;
        img.onload = () => {
            size.innerText = `${img.naturalWidth} x ${img.naturalHeight}`;
            img.setAttribute("loaded", true);
            if (imgs.length == 1) { img.click(); overlay.click(); }
        };
        img.onerror = () => {
            size.remove(); img.remove(); imgs.splice(i, 1);
            if (imgs.length == 1 && imgs[0].getAttribute("loaded")) { imgs[0].click(); overlay.click(); }
        };
        img.onclick = () => {
            let mouse = getMousePos();
            createPreview(src, mouse.x, mouse.y, () => { }, (_src) => { img.src = _src; });
        };
        imgs.push(img);
        con.appendChild(img);
    }
    overlay.appendChild(container);
}

// A helper for CORS-free dataUrl
function getImageDataUrl(url, cb) {
    if (url.startsWith("data:")) return cb(url);
    chrome.runtime.sendMessage({ action: "fetch_image_base64", url }, (res) => {
        if (res && res.dataUrl) cb(res.dataUrl);
        else cb(url); // fallback
    });
}

function createPreview(src, _x, _y, onClose = () => { }, onFoundBigImg = () => { }) {
    const { x, y } = validateMouse(_x, _y);
    const id = "ufs-magnify-image";
    if (document.getElementById(id)) document.getElementById(id).remove();

    let overlay = document.createElement("div");
    overlay.id = id;
    overlay.innerHTML = `
    <div class="ufs-img-anim" style="top: ${y}px; left: ${x}px;"></div>
    <img src="${src}" style="top: ${window.innerHeight / 2}px; left: ${window.innerWidth / 2}px; transform-origin: center; transform: translate(-50%, -50%) !important; max-width: 100vw; max-height: 100vh; opacity: 0;"/>
    <div class="ufs-toolbar">
      <div class="ufs-btn" ufs_title="Original size">Size</div>
      <div class="ufs-btn" ufs_title="Toggle original size">Z</div>
      <div class="ufs-btn" ufs_title="Toggle background">B</div>
      <div class="ufs-btn" ufs_title="Flip horizontal">↔</div>
      <div class="ufs-btn" ufs_title="Flip vertical">↕</div>
      <div class="ufs-btn" ufs_title="Rotate left">↺</div>
      <div class="ufs-btn" ufs_title="Rotate right">↻</div>
      <div class="ufs-btn" ufs_title="Scan QR/Barcode">🔍</div>
      <div class="ufs-btn" ufs_title="Extract Text (OCR)">T</div>
      <div class="ufs-btn" ufs_title="Open in new tab">↗</div>
      <div class="ufs-desc"></div>
    </div>
  `;
    document.body.appendChild(overlay);

    const animDiv = overlay.querySelector(".ufs-img-anim");
    const img = overlay.querySelector("img");
    const toolbar = overlay.querySelector(".ufs-toolbar");
    const [sizeEle, zoomEle, toggleBg, flipH, flipV, rotateLeft, rotateRight, scanQr, extractText, openNewTab] = Array.from(toolbar.querySelectorAll(".ufs-btn"));

    function updateZoom() {
        if (img.naturalWidth && img.naturalHeight) {
            let zoom = (parseFloat(img.style.width) / img.naturalWidth).toFixed(1);
            if (parseInt(zoom) == zoom) zoom = parseInt(zoom);
            zoomEle.innerText = `${zoom}x`;
        }
    }

    const { destroy, animateTo } = enableDragAndZoom(img, overlay, (updatedValue) => {
        if ("width" in updatedValue || "height" in updatedValue) updateZoom();
    });

    overlay.addEventListener("click", (e) => {
        if (e.target == overlay) {
            overlay.remove();
            destroy();
            onClose?.();
        }
    });

    let isFirstLoad = false;
    img.onload = () => {
        let curW = img.naturalWidth, curH = img.naturalHeight;
        if (!isFirstLoad) {
            isFirstLoad = true;
            let newSize = resizeToFitWithMinSize(curW, curH, Math.max(window.innerWidth - 100, 400), Math.max(window.innerHeight - 100, 400), 100);
            img.style.width = `${newSize.width}px`; img.style.height = `${newSize.height}px`; img.style.opacity = 1;

            animDiv.style.top = img.style.top; animDiv.style.left = img.style.left;
            animDiv.style.width = img.style.width; animDiv.style.height = img.style.height;
            animDiv.style.borderRadius = 0; animDiv.style.opacity = 0;
            setTimeout(() => animDiv.remove(), 300);
        } else {
            let newRatio = curW / curH;
            img.style.height = `${parseInt(img.style.width) / newRatio}px`;
        }
        sizeEle.innerText = `${img.naturalWidth} x ${img.naturalHeight}`;
        updateZoom();
    };

    zoomEle.onclick = () => {
        let w = img.naturalWidth, h = img.naturalHeight;
        if (parseInt(img.style.width) === w && parseInt(img.style.height) === h) {
            let newSize = resizeToFitWithMinSize(w, h, Math.max(window.innerWidth - 100, 400), Math.max(window.innerHeight - 100, 400), 100);
            w = newSize.width; h = newSize.height;
        }
        animateTo(window.innerWidth / 2, window.innerHeight / 2, w, h);
        updateZoom();
    };

    const bgStates = [BgState.none, BgState.transparent, BgState.dark, BgState.light];
    let curBgState = (Number(localStorage.getItem("ufs-magnify-image-bg")) || 0) - 1;
    toggleBg.onclick = () => {
        curBgState = (curBgState + 1) % bgStates.length;
        img.style.background = "";
        if (bgStates[curBgState] === BgState.transparent) img.style.cssText += "background: linear-gradient(45deg, rgba(255, 255, 255, 0.4) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.4) 75%, rgba(255, 255, 255, 0.4) 100%) 0 0 / 20px 20px, linear-gradient(45deg, rgba(255, 255, 255, 0.4) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.4) 75%, rgba(255, 255, 255, 0.4) 100%) 10px 10px / 20px 20px !important;";
        else if (bgStates[curBgState] === BgState.dark) img.style.background = "rgba(30, 30, 30, 1)";
        else if (bgStates[curBgState] === BgState.light) img.style.background = "rgba(240, 240, 240, 1)";
        toggleBg.innerText = "BG " + bgStates[curBgState];
        localStorage.setItem("ufs-magnify-image-bg", curBgState);
    };
    toggleBg.click();

    const transform = { flip_horizontal: false, flip_vertical: false, rotate: 0 };
    flipH.onclick = () => {
        if (transform.flip_horizontal) { img.style.transform = img.style.transform.replace("scaleX(-1)", ""); transform.flip_horizontal = false; }
        else { img.style.transform += " scaleX(-1)"; transform.flip_horizontal = true; }
    };
    flipV.onclick = () => {
        if (transform.flip_vertical) { img.style.transform = img.style.transform.replace("scaleY(-1)", ""); transform.flip_vertical = false; }
        else { img.style.transform += " scaleY(-1)"; transform.flip_vertical = true; }
    };
    rotateLeft.onclick = () => {
        img.style.transform = img.style.transform.replace(`rotate(${transform.rotate}deg)`, "");
        transform.rotate -= 90; img.style.transform += ` rotate(${transform.rotate}deg)`;
    };
    rotateRight.onclick = () => {
        img.style.transform = img.style.transform.replace(`rotate(${transform.rotate}deg)`, "");
        transform.rotate += 90; img.style.transform += ` rotate(${transform.rotate}deg)`;
    };
    openNewTab.onclick = () => window.open(img.src, "_blank");

    scanQr.onclick = () => {
        let prevText = scanQr.innerText;
        scanQr.innerText = "⏳";
        getImageDataUrl(img.src, (dataUrl) => {
            let tempImg = new Image();
            tempImg.onload = () => {
                try {
                    const canvas = document.createElement("canvas");
                    const ctx = canvas.getContext("2d");
                    canvas.width = tempImg.naturalWidth;
                    canvas.height = tempImg.naturalHeight;
                    ctx.drawImage(tempImg, 0, 0);
                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const code = window.jsQR && window.jsQR(imageData.data, imageData.width, imageData.height);
                    scanQr.innerText = prevText;
                    if (code && code.data) {
                        const result = prompt("Found QR Code:", code.data);
                        if (result && result.startsWith("http")) window.open(result, "_blank");
                    } else {
                        alert("No QR Code found!");
                    }
                } catch (e) {
                    scanQr.innerText = prevText;
                    alert("Error scanning QR");
                }
            };
            tempImg.onerror = () => {
                scanQr.innerText = prevText;
                alert("Failed to load image for scanning.");
            };
            tempImg.src = dataUrl;
        });
    };

    extractText.onclick = () => {
        if (!window.Tesseract) { alert("Tesseract.js not loaded."); return; }
        let prevText = extractText.innerText;
        extractText.innerText = "⏳";

        getImageDataUrl(img.src, (dataUrl) => {
            Tesseract.recognize(dataUrl, 'eng')
                .then(({ data: { text } }) => {
                    extractText.innerText = prevText;
                    if (!text || !text.trim()) {
                        alert("No text found!");
                        return;
                    }

                    let resultId = "ufs-ocr-result";
                    if (document.getElementById(resultId)) document.getElementById(resultId).remove();

                    let bgOverlay = document.createElement("div");
                    bgOverlay.id = resultId;
                    bgOverlay.style.cssText = `position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:2147483647;display:flex;align-items:center;justify-content:center;`;
                    let textAreaContainer = document.createElement("div");
                    textAreaContainer.style.cssText = `background:#fff;padding:20px;border-radius:8px;width:80%;max-width:600px;display:flex;flex-direction:column;gap:10px;box-shadow: 0 10px 30px rgba(0,0,0,0.5);`;

                    let title = document.createElement("h3");
                    title.innerText = "Extracted Text (OCR)";
                    title.style.margin = "0"; title.style.color = "#333"; title.style.fontFamily = "sans-serif";

                    let textArea = document.createElement("textarea");
                    textArea.value = text;
                    textArea.style.cssText = `width:100%;height:300px;padding:10px;border:1px solid #ccc;border-radius:4px;resize:vertical;font-family:monospace;font-size:14px;outline:none;`;

                    let btnRow = document.createElement("div");
                    btnRow.style.cssText = `display:flex;justify-content:flex-end;gap:10px;margin-top:5px;`;

                    let copyBtn = document.createElement("button");
                    copyBtn.innerText = "Copy to Clipboard";
                    copyBtn.style.cssText = `padding:8px 16px;cursor:pointer;background:#4CAF50;color:#fff;border:none;border-radius:4px;font-weight:bold;font-size:14px;`;
                    copyBtn.onclick = () => {
                        navigator.clipboard.writeText(textArea.value).then(() => {
                            copyBtn.innerText = "Copied!";
                            copyBtn.style.background = "#2E7D32";
                            setTimeout(() => { copyBtn.innerText = "Copy to Clipboard"; copyBtn.style.background = "#4CAF50"; }, 2000);
                        });
                    };

                    let closeBtn = document.createElement("button");
                    closeBtn.innerText = "Close";
                    closeBtn.style.cssText = `padding:8px 16px;cursor:pointer;background:#f44336;color:#fff;border:none;border-radius:4px;font-weight:bold;font-size:14px;`;
                    closeBtn.onclick = () => bgOverlay.remove();

                    bgOverlay.onclick = (e) => {
                        if (e.target === bgOverlay) bgOverlay.remove();
                    };

                    btnRow.appendChild(copyBtn);
                    btnRow.appendChild(closeBtn);
                    textAreaContainer.appendChild(title);
                    textAreaContainer.appendChild(textArea);
                    textAreaContainer.appendChild(btnRow);
                    bgOverlay.appendChild(textAreaContainer);
                    document.body.appendChild(bgOverlay);
                })
                .catch(err => {
                    extractText.innerText = prevText;
                    console.error("OCR Error", err);
                    alert("Error extracting text!");
                });
        });
    };
}

function lerp(from, to, speed) { return from + (to - from) * speed; }

function enableDragAndZoom(element, container, onUpdateCallback) {
    const className = "ufs-drag-and-zoom";
    element.classList.add(className);

    let style = document.createElement("style");
    style.textContent = `.${className} { cursor: grab; position: relative !important; user-select: none !important; max-width: unset !important; max-height: unset !important; -webkit-user-drag: none !important; }`;
    (container || element).appendChild(style);

    const lerpSpeed = 0.3; const last = { x: 0, y: 0 }; const mouse = { x: 0, y: 0 };
    const animTarget = { left: parseFloat(element.style.left || 0), top: parseFloat(element.style.top || 0), width: parseFloat(element.style.width || element.clientWidth), height: parseFloat(element.style.height || element.clientHeight) };

    let run = true;
    function animate() {
        let updated = false; let updatedValue = {};
        for (let prop in animTarget) {
            const currentValue = parseFloat(element.style[prop] || 0);
            const targetValue = animTarget[prop];
            let del = Math.abs(targetValue - currentValue);
            if (del > 0.1) {
                const newValue = del < 1 ? targetValue : lerp(currentValue, targetValue, lerpSpeed);
                element.style[prop] = newValue + "px"; updatedValue[prop] = newValue; updated = true;
            }
        }
        if (updated) onUpdateCallback?.(updatedValue);
        if (run) requestAnimationFrame(animate);
    }
    animate();

    let dragging = false;
    const t = container || element;

    const mousedown = (e) => { e.preventDefault(); dragging = true; last.x = e.clientX; last.y = e.clientY; element.style.cursor = "grabbing"; };
    t.addEventListener("mousedown", mousedown);

    const mousemove = (e) => {
        mouse.x = e.clientX; mouse.y = e.clientY;
        if (dragging) { animTarget.left += e.clientX - last.x; animTarget.top += e.clientY - last.y; last.x = e.clientX; last.y = e.clientY; }
    };
    document.addEventListener("mousemove", mousemove);

    const mouseup = () => { dragging = false; element.style.cursor = "grab"; };
    document.addEventListener("mouseup", mouseup);

    const mouseleave = () => { dragging = false; element.style.cursor = "grab"; };
    document.addEventListener("mouseleave", mouseleave);

    const wheel = (e) => {
        e.preventDefault();
        const curScale = parseFloat(element.style.width) / element.width;
        const delta = -e.wheelDeltaY || -e.wheelDelta;
        const factor = Math.abs((0.3 * delta) / 120);
        const newScale = delta > 0 ? curScale * (1 - factor) : curScale * (1 + factor);
        const newW = element.width * newScale; const newH = element.height * newScale;
        if (newW < 10 || newH < 10) return;
        const left = parseFloat(element.style.left); const top = parseFloat(element.style.top);
        animTarget.left = left - (newW - element.width) * ((mouse.x - left) / element.width);
        animTarget.top = top - (newH - element.height) * ((mouse.y - top) / element.height);
        animTarget.width = newW; animTarget.height = newH;
    };
    t.addEventListener("wheel", wheel, { passive: false });

    return {
        animateTo: (x, y, w, h) => { animTarget.left = x; animTarget.top = y; animTarget.width = w; animTarget.height = h; },
        destroy: () => {
            run = false; style.remove(); element.classList.remove(className);
            t.removeEventListener("mousedown", mousedown);
            document.removeEventListener("mousemove", mousemove);
            document.removeEventListener("mouseup", mouseup);
            document.removeEventListener("mouseleave", mouseleave);
            t.removeEventListener("wheel", wheel);
        },
    };
}

// ===================== Gallery Mode =====================
function openGalleryMode() {
    let id = "ufs-gallery-mode-overlay";
    if (document.getElementById(id)) return;

    let overlay = document.createElement("div");
    overlay.id = id;
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(20, 20, 20, 0.95); z-index: 2147483647;
        display: flex; flex-direction: column; color: white;
        font-family: sans-serif;
    `;

    // Header toolbar
    let header = document.createElement("div");
    header.style.cssText = `
        padding: 15px 20px; background: #222; display: flex;
        justify-content: space-between; align-items: center;
        box-shadow: 0 4px 10px rgba(0,0,0,0.5);
    `;

    let leftControls = document.createElement("div");
    leftControls.style.cssText = "display: flex; gap: 10px; align-items: center;";
    leftControls.innerHTML = `
        <strong style="font-size: 18px; margin-right: 15px;">Gallery Mode</strong>
        <label>Width: <input type="number" id="ufs-gal-mw" placeholder="Auto" style="width: 70px; padding: 4px;"/></label>
        <label>Height: <input type="number" id="ufs-gal-mh" placeholder="Auto" style="width: 70px; padding: 4px;"/></label>
    `;

    let rightControls = document.createElement("div");
    rightControls.style.cssText = "display: flex; gap: 10px; align-items: center;";
    rightControls.innerHTML = `
        <span id="ufs-gal-count">0 images</span>
        <button id="ufs-gal-sel-all" style="padding: 5px 10px; cursor: pointer; border-radius: 4px;">Select All</button>
        <button id="ufs-gal-dl" style="padding: 5px 10px; cursor: pointer; background: #4CAF50; color: white; border: none; border-radius: 4px; font-weight: bold;">Download ZIP</button>
        <button id="ufs-gal-close" style="padding: 5px 10px; cursor: pointer; background: #f44336; color: white; border: none; border-radius: 4px;">Close</button>
    `;

    header.appendChild(leftControls);
    header.appendChild(rightControls);
    overlay.appendChild(header);

    // Body Grid
    let grid = document.createElement("div");
    grid.style.cssText = `
        flex: 1; overflow-y: auto; padding: 20px; min-height: 0;
        display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 20px; align-content: start; grid-auto-rows: max-content;
    `;
    overlay.appendChild(grid);
    document.body.appendChild(overlay);

    // Collect all images from the page
    let allElements = Array.from(document.querySelectorAll('*'));
    let srcSet = new Set();
    allElements.forEach(ele => {
        let srcs = getImgSrcsFromElement(ele);
        if (srcs) {
            srcs.forEach(src => srcSet.add(src));
        }
    });

    let imagesData = [];
    let debounceTimer = null;

    // Helper to render grid
    function renderGrid() {
        grid.innerHTML = "";

        let filtered = imagesData;
        document.getElementById("ufs-gal-count").innerText = `${filtered.length} images`;

        filtered.forEach((imgData, index) => {
            let card = document.createElement("div");
            card.style.cssText = `
                position: relative; background: #333; border-radius: 8px; overflow: hidden;
                display: flex; flex-direction: column; align-items: center; cursor: pointer;
                box-shadow: 0 4px 6px rgba(0,0,0,0.3); border: 2px solid transparent;
                transition: transform 0.2s;
            `;
            if (imgData.selected) card.style.borderColor = "#4CAF50";

            let imgWrapper = document.createElement("div");
            imgWrapper.style.cssText = "width: 100%; height: 150px; display: flex; align-items: center; justify-content: center; background: #222;";

            let imgEle = document.createElement("img");
            imgEle.src = imgData.src;
            imgEle.style.cssText = "max-width: 100%; max-height: 100%; object-fit: contain;";

            let info = document.createElement("div");
            info.style.cssText = "width: 100%; padding: 8px; text-align: center; font-size: 12px; background: rgba(0,0,0,0.8); position: absolute; bottom: 0;";
            info.innerText = `${imgData.w} x ${imgData.h}`;

            let checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = imgData.selected;
            checkbox.style.cssText = "position: absolute; top: 10px; left: 10px; width: 20px; height: 20px; cursor: pointer; pointer-events: none;";

            card.onclick = () => {
                imgData.selected = !imgData.selected;
                checkbox.checked = imgData.selected;
                card.style.borderColor = imgData.selected ? "#4CAF50" : "transparent";
            };

            imgWrapper.appendChild(imgEle);
            card.appendChild(imgWrapper);
            card.appendChild(info);
            card.appendChild(checkbox);
            grid.appendChild(card);
        });
    }

    // Load images
    srcSet.forEach(src => {
        let temp = new Image();
        temp.onload = () => {
            if (temp.naturalWidth > 1 && temp.naturalHeight > 1) { // ignore 1x1 pixels
                imagesData.push({ src: src, w: temp.naturalWidth, h: temp.naturalHeight, selected: true });
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(renderGrid, 500); // Batch renders
            }
        };
        temp.src = src;
    });

    // Events
    document.getElementById("ufs-gal-close").onclick = () => overlay.remove();

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target === grid) {
            overlay.remove();
        }
    });

    let allSelected = true;
    document.getElementById("ufs-gal-sel-all").onclick = () => {
        allSelected = !allSelected;
        imagesData.forEach(img => img.selected = allSelected);
        renderGrid();
    };

    document.getElementById("ufs-gal-dl").onclick = async () => {
        if (!window.JSZip) { alert("JSZip library not found!"); return; }

        let targetW = parseInt(document.getElementById("ufs-gal-mw").value) || null;
        let targetH = parseInt(document.getElementById("ufs-gal-mh").value) || null;

        let toDownload = imagesData.filter(img => img.selected);
        if (toDownload.length === 0) { alert("No images selected!"); return; }

        let btn = document.getElementById("ufs-gal-dl");
        btn.innerText = "Zipping...";
        btn.disabled = true;

        let zip = new JSZip();
        let promises = toDownload.map((img, i) => {
            return new Promise((resolve) => {
                getImageDataUrl(img.src, (dataUrl) => {
                    if (targetW || targetH) {
                        let tempImg = new Image();
                        tempImg.onload = () => {
                            let canvas = document.createElement("canvas");
                            canvas.width = targetW || (targetH * tempImg.naturalWidth / tempImg.naturalHeight);
                            canvas.height = targetH || (targetW * tempImg.naturalHeight / tempImg.naturalWidth);
                            if (targetW && targetH) {
                                canvas.width = targetW;
                                canvas.height = targetH;
                            }
                            let ctx = canvas.getContext("2d");
                            ctx.drawImage(tempImg, 0, 0, canvas.width, canvas.height);
                            let resizedDataUrl = canvas.toDataURL("image/png");
                            let parts = resizedDataUrl.split(',');
                            if (parts.length > 1) {
                                zip.file(`image_${i + 1}.png`, parts[1], { base64: true });
                            }
                            resolve();
                        };
                        tempImg.onerror = () => resolve();
                        tempImg.src = dataUrl;
                    } else {
                        let parts = dataUrl.split(',');
                        if (parts.length > 1) {
                            zip.file(`image_${i + 1}.png`, parts[1], { base64: true });
                        }
                        resolve();
                    }
                });
            });
        });

        await Promise.all(promises);

        zip.generateAsync({ type: "blob" }).then(content => {
            let a = document.createElement("a");
            a.href = URL.createObjectURL(content);
            a.download = "images_gallery.zip";
            a.click();
            btn.innerText = "Download ZIP";
            btn.disabled = false;
        }).catch(err => {
            alert("Error creating ZIP!");
            btn.innerText = "Download ZIP";
            btn.disabled = false;
        });
    };
}


// ===================== Initialization =====================
initHoverAndCtrl();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "magnify_image_from_context") {
        if (!extensionEnabled) return;
        let srcUrl = request.details?.srcUrl;
        if (srcUrl) {
            createPreview(srcUrl);
        } else {
            magnifyImage();
        }
    } else if (request.action === "magnify_gallery_mode") {
        if (!extensionEnabled) return;
        openGalleryMode();
    }
});
