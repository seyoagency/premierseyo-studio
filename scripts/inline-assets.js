#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const htmlPath = path.join(root, "src/index.html");
const cssPath = path.join(root, "src/ui/styles.css");
const bundlePath = path.join(root, "src/bundle.js");

const html = fs.readFileSync(htmlPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
const bundle = fs.readFileSync(bundlePath, "utf8");

const stylePattern = /<style id="inline-styles">[\s\S]*?<\/style>/;
const scriptPattern = /<script>[\s\S]*?<\/script>\s*<\/body>/;

if (!stylePattern.test(html)) throw new Error("inline style block bulunamadi");
const withCss = html.replace(stylePattern, `<style id="inline-styles">${css}</style>`);

if (!scriptPattern.test(withCss)) throw new Error("inline script block bulunamadi");
const withBundle = withCss.replace(scriptPattern, `<script>\n${bundle}\n  </script>\n</body>`);

fs.writeFileSync(htmlPath, withBundle, "utf8");
