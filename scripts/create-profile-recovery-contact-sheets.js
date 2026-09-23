#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const inputRoot = path.resolve(process.argv[2] || "");
const outputRoot = path.resolve(process.argv[3] || path.join(inputRoot, "contact-sheets"));
const tileWidth = 240;
const tileHeight = 320;
const columns = 4;

async function createSheet(directory) {
  const sourceDirectory = path.join(inputRoot, directory);
  const files = fs.readdirSync(sourceDirectory)
    .filter((name) => /\.(?:jpe?g|png|webp)$/i.test(name))
    .sort();
  const rows = Math.ceil(files.length / columns);
  const composites = [];

  for (let index = 0; index < files.length; index += 1) {
    const input = path.join(sourceDirectory, files[index]);
    const thumbnail = await sharp(input)
      .rotate()
      .resize(tileWidth, tileHeight, { fit: "contain", background: "#111111" })
      .jpeg({ quality: 82 })
      .toBuffer();
    composites.push({
      input: thumbnail,
      left: (index % columns) * tileWidth,
      top: Math.floor(index / columns) * tileHeight
    });
  }

  const output = path.join(outputRoot, `${directory}.jpg`);
  await sharp({
    create: {
      width: columns * tileWidth,
      height: rows * tileHeight,
      channels: 3,
      background: "#111111"
    }
  }).composite(composites).jpeg({ quality: 88 }).toFile(output);
  return { directory, files: files.length, output };
}

async function main() {
  fs.mkdirSync(outputRoot, { recursive: true });
  const directories = fs.readdirSync(inputRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => Number(left) - Number(right));
  const sheets = [];
  for (const directory of directories) sheets.push(await createSheet(directory));
  console.log(JSON.stringify({ input_root: inputRoot, output_root: outputRoot, sheets }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
