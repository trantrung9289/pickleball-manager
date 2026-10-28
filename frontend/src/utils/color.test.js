// Chạy: npm test (node --test). Lớp 1 đổi giao diện: màu thương hiệu → bộ màu đủ tương phản.
import test from "node:test";
import assert from "node:assert/strict";
import { brandPalette, contrast, cssVariables, DEFAULT_BRAND, ensureContrast, isHex, mix, SEMANTIC, semanticFor } from "./color.js";

test("isHex / mix", () => {
  assert.equal(isHex("#EC671C"), true); assert.equal(isHex("orange"), false); assert.equal(isHex("#abc"), false);
  assert.equal(mix("#000000", "#FFFFFF", 0.5), "#808080");
});

test("brandPalette sáng: chữ trắng trên brand ≥ 4.5, strong trên soft ≥ 4.5, màu lạ về mặc định", () => {
  for (const c of ["#EC671C", "#27A063", "#60A5FA", "#FDE047", "#0065B3"]) {
    const p = brandPalette(c);
    assert.ok(contrast(p.brand, "#FFFFFF") >= 4.5, `${c} brand ${contrast(p.brand, "#FFFFFF")}`);
    assert.ok(contrast(p.brandStrong, p.brandSoft) >= 4.5, `${c} strong/soft`);
  }
  assert.equal(brandPalette("xxx").base, DEFAULT_BRAND);
  assert.equal(ensureContrast("#FFFFFF", "#FFFFFF", 4.5).length, 7);
});

test("brandPalette tối: brand nổi trên nền #1E232B ≥ 4.5", () => {
  for (const c of ["#EC671C", "#1F8A52", "#334155"]) {
    const p = brandPalette(c, true);
    assert.ok(contrast(p.brand, "#1E232B") >= 4.5, `${c} dark brand`);
    assert.ok(contrast(p.brandStrong, p.brandSoft) >= 4.5, `${c} dark strong/soft`);
  }
});

test("SEMANTIC: chữ strong trên nền soft và chữ trắng trên màu chính đều ≥ 4.5 (sáng)", () => {
  const s = SEMANTIC.light;
  for (const k of ["ok", "warn", "danger", "info"]) {
    assert.ok(contrast(s[`${k}Strong`], s[`${k}Soft`]) >= 4.5, `${k} strong/soft`);
    assert.ok(contrast(s[k], "#FFFFFF") >= 4.5, `${k} on white`);
  }
  assert.ok(contrast(s.muted, s.surface) >= 4.5);
  const v = cssVariables("#EC671C");
  assert.ok(v["--brand"] && v["--ok-soft"] && v["--sidebar"] === undefined);
});

test("galaxy: brand nổi trên surface xanh đen ≥ 4.5, strong trên soft ≥ 4.5, chữ/ phụ trên surface ≥ 4.5, cssVariables theo mode", () => {
  const g = SEMANTIC.galaxy;
  assert.equal(semanticFor("galaxy"), g); assert.equal(semanticFor(true), SEMANTIC.dark); assert.equal(semanticFor(false), SEMANTIC.light);
  assert.ok(contrast(g.ink, g.surface) >= 4.5 && contrast(g.muted, g.surface) >= 4.5);
  for (const k of ["ok", "warn", "danger", "info"]) assert.ok(contrast(g[`${k}Strong`], g[`${k}Soft`]) >= 4.5, k);
  for (const c of ["#1F8A52", "#EC671C", "#0065B3", "#6D28D9", "#B42318", "#334155"]) {
    const p = brandPalette(c, true, g.surface);
    assert.ok(contrast(p.brand, g.surface) >= 4.5, c);
    assert.ok(contrast(p.brandStrong, p.brandSoft) >= 4.5, c);
  }
  const v = cssVariables("#1F8A52", "galaxy");
  assert.equal(v["--bg"], g.bg); assert.equal(v["--surface"], g.surface);
  assert.equal(cssVariables("#1F8A52", true)["--bg"], SEMANTIC.dark.bg);
  assert.equal(cssVariables("#1F8A52", false)["--bg"], SEMANTIC.light.bg);
});

