const TINTS = ["#FFE55C", "#FF6FAE", "#68D9F5", "#8BE7B1", "#ffffff"];

function createImpostorSvg(withQuestion) {
  return `
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path
        d="M16 26C16 15.5 23.2 9 32 9C40.8 9 48 15.5 48 26V47C48 50.3 45.3 53 42 53H39V45H25V53H22C18.7 53 16 50.3 16 47V26Z"
        fill="currentColor"
      />
      <rect x="28" y="19" width="21" height="11" rx="5.5" fill="#18103a" />
      <circle cx="42" cy="24.5" r="2.2" fill="#ffffff" />
      ${
        withQuestion
          ? `<text x="48" y="13" fill="#FFE55C" font-size="14" font-weight="900" font-family="sans-serif">?</text>`
          : ""
      }
    </svg>
  `;
}

export function mountPolkaDotsBackground() {
  if (document.querySelector(".bg-dots-pattern")) return;

  const dotsLayer = document.createElement("div");
  dotsLayer.className = "bg-dots-pattern";
  dotsLayer.setAttribute("aria-hidden", "true");

  document.body.prepend(dotsLayer);
}

export function mountFunnyBackground(count = 11) {
  if (document.querySelector(".bg-fun-layer")) return;

  const layer = document.createElement("div");
  layer.className = "bg-fun-layer";
  layer.setAttribute("aria-hidden", "true");

  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    el.className = "bg-impostor-sprite";

    const x = Math.round(((i + 0.5) / count) * 100 + (Math.random() * 8 - 4));
    const size = Math.round(36 + Math.random() * 26);
    const duration = (15 + Math.random() * 12).toFixed(1) + "s";
    const delay = (-Math.random() * 20).toFixed(1) + "s";
    const drift = Math.round((Math.random() > 0.5 ? 1 : -1) * (18 + Math.random() * 28)) + "px";
    const rotStart = Math.round(-18 + Math.random() * 12) + "deg";
    const rotEnd = Math.round(8 + Math.random() * 14) + "deg";
    const tint = TINTS[i % TINTS.length];
    const peakOpacity = (0.14 + Math.random() * 0.1).toFixed(2);

    el.style.setProperty("--x", `${x}%`);
    el.style.setProperty("--size", `${size}px`);
    el.style.setProperty("--duration", duration);
    el.style.setProperty("--delay", delay);
    el.style.setProperty("--drift", drift);
    el.style.setProperty("--rot-start", rotStart);
    el.style.setProperty("--rot-end", rotEnd);
    el.style.setProperty("--tint", tint);
    el.style.setProperty("--peak-opacity", peakOpacity);

    el.innerHTML = createImpostorSvg(i % 2 === 0);
    layer.appendChild(el);
  }

  document.body.prepend(layer);
}

export function initBackgroundAnimations(impostorCount = 11) {
  mountPolkaDotsBackground();
  mountFunnyBackground(impostorCount);
}