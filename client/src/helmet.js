const HELMET_ORIGINAL_COLOR = "#e10000";
let helmetSvgText = null;

async function fetchHelmetSvg() {
  if (helmetSvgText) return helmetSvgText;
  const resp = await fetch("/helmet.svg");
  helmetSvgText = await resp.text();
  return helmetSvgText;
}

export async function helmetDataUrl(color) {
  const svg = await fetchHelmetSvg();
  const recolored = svg.replaceAll(HELMET_ORIGINAL_COLOR, color);
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(recolored);
}

export async function loadHelmetTexture(scene, color) {
  const key = `helmet_${color}`;
  if (scene.textures.exists(key)) return;
  const svg = await fetchHelmetSvg();
  const recolored = svg.replaceAll(HELMET_ORIGINAL_COLOR, color);
  const blob = new Blob([recolored], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const dpr = window.devicePixelRatio || 1;
      const aspect = img.naturalWidth / img.naturalHeight;
      const baseH = Math.round(64 * dpr);
      const w = Math.round(baseH * aspect);
      const h = baseH;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      scene.textures.addCanvas(key, canvas);
      URL.revokeObjectURL(url);
      resolve();
    };
    img.src = url;
  });
}
