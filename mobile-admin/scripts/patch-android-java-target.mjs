import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const targets = [
  "android/app/capacitor.build.gradle",
  "android/capacitor-cordova-android-plugins/build.gradle",
  "node_modules/@capacitor/android/capacitor/build.gradle",
];

for (const relativePath of targets) {
  const filePath = resolve(root, relativePath);
  const before = readFileSync(filePath, "utf8");
  const after = before.replaceAll("JavaVersion.VERSION_21", "JavaVersion.VERSION_17");

  if (after !== before) {
    writeFileSync(filePath, after);
    console.log(`patched ${relativePath}`);
  } else {
    console.log(`ok ${relativePath}`);
  }
}
