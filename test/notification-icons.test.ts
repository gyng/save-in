import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ICONS = {
  info: { file: "notification-info.svg", color: "#2563eb" },
  success: { file: "notification-success.svg", color: "#15803d" },
  error: { file: "notification-error.svg", color: "#dc2626" },
} as const;

const readIcon = (file: string) => readFileSync(resolve("icons", file), "utf8");

const luminance = (hex: string) => {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((part) => parseInt(part, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

const contrast = (a: string, b: string) => {
  const [lighter, darker] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
};

describe("notification status icons", () => {
  test.each(Object.entries(ICONS))("%s is a complete, theme-neutral SVG", (_status, icon) => {
    const svg = readIcon(icon.file);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="128" height="128" viewBox="0 0 128 128"');
    expect(svg).toContain(`fill="${icon.color}"`);
    expect(svg).toContain('stroke="#fff"');
    expect(svg).not.toMatch(/prefers-color-scheme|<style|currentColor/);
  });

  test("runtime notification paths reference every status asset", () => {
    const source = readFileSync(resolve("src", "downloads", "notification.ts"), "utf8");
    Object.values(ICONS).forEach(({ file }) => {
      expect(source).toContain(`icons/${file}`);
    });
  });

  test.each([
    ["light", "#ffffff"],
    ["dark", "#202124"],
  ])("status badges retain non-text contrast on a %s surface", (_theme, surface) => {
    Object.values(ICONS).forEach(({ color }) => {
      expect(contrast(color, surface)).toBeGreaterThanOrEqual(3);
    });
  });

  test("status glyphs are distinct while retaining the shared Save In background", () => {
    const svgs = Object.values(ICONS).map(({ file }) => readIcon(file));
    expect(new Set(svgs).size).toBe(Object.keys(ICONS).length);
    svgs.forEach((svg) => {
      expect(svg).toContain('fill="#475569"');
      expect(svg).toContain('cx="91" cy="91" r="25"');
    });
  });
});
