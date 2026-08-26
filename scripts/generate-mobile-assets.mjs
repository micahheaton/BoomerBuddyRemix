import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import sharp from 'sharp';

const assetDirectory = fileURLToPath(new URL('../apps/mobile/assets/', import.meta.url));

const colors = {
  canvas: '#F7F5EF',
  primary: '#174D6B',
  primaryHover: '#10394F',
  onPrimary: '#FFFFFF',
};

function shield(transform) {
  return `<g transform="${transform}">
    <path d="M17 1.5 31.5 7v10.2c0 9.1-5.7 15.7-14.5 19.3C8.2 32.9 2.5 26.3 2.5 17.2V7L17 1.5Z" fill="${colors.primary}" stroke="${colors.primaryHover}" stroke-width="2.5"/>
    <path d="m10.2 19 4.1 4.1 9.7-10" fill="none" stroke="${colors.onPrimary}" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"/>
  </g>`;
}

function svg(size, body, background = '') {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${background}${body}</svg>`,
  );
}

async function render(input, size, opaque) {
  const pipeline = sharp(input).resize(size, size);
  if (opaque) pipeline.removeAlpha();
  return pipeline.png({ compressionLevel: 9 }).toBuffer();
}

const assets = [
  {
    filename: 'icon.png',
    input: svg(
      1024,
      shield('translate(222 188) scale(17.05)'),
      `<rect width="1024" height="1024" fill="${colors.canvas}"/>`,
    ),
    opaque: true,
    size: 1024,
  },
  {
    filename: 'adaptive-icon.png',
    input: svg(1024, shield('translate(282 255) scale(13.5)')),
    opaque: false,
    size: 1024,
  },
  {
    filename: 'splash-icon.png',
    input: svg(1024, shield('translate(332 310) scale(10.6)')),
    opaque: false,
    size: 1024,
  },
  {
    filename: 'favicon.png',
    input: svg(
      256,
      shield('translate(22 10) scale(6.2)'),
      `<rect width="256" height="256" fill="${colors.canvas}"/>`,
    ),
    opaque: true,
    size: 256,
  },
];

const rendered = await Promise.all(
  assets.map(async (asset) => ({
    ...asset,
    output: await render(asset.input, asset.size, asset.opaque),
  })),
);

if (process.argv.includes('--check')) {
  for (const asset of rendered) {
    const committed = await readFile(`${assetDirectory}/${asset.filename}`);
    if (!committed.equals(asset.output)) {
      throw new Error(
        `${asset.filename} does not match the deterministic generator. Run npm run mobile:assets.`,
      );
    }
  }
  const hashes = Object.fromEntries(
    rendered.map((asset) => [
      asset.filename,
      createHash('sha256').update(asset.output).digest('hex'),
    ]),
  );
  process.stdout.write(
    `Verified deterministic BoomerBuddy mobile assets: ${JSON.stringify(hashes)}\n`,
  );
} else {
  await mkdir(assetDirectory, { recursive: true });
  await Promise.all(
    rendered.map((asset) => writeFile(`${assetDirectory}/${asset.filename}`, asset.output)),
  );
  process.stdout.write('Generated deterministic BoomerBuddy mobile assets.\n');
}
