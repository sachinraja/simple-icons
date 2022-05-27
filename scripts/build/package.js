#!/usr/bin/env node
/**
 * @fileoverview
 * Compiles our icons into static .js files that can be imported in the browser
 * and are tree-shakeable. The static .js files go in icons/{filename}.js. Also
 * generates an index.js that exports all icons by title, but is not
 * tree-shakeable
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { transform as esbuildTransform } from 'esbuild';
import {
  getIconSlug,
  svgToPath,
  slugToVariableName,
  getIconsData,
  getDirnameFromImportMeta,
} from '../utils.js';
import { titleToHtmlFriendly } from '../../utils.mjs';

const __dirname = getDirnameFromImportMeta(import.meta.url);

const UTF8 = 'utf8';

const rootDir = path.resolve(__dirname, '..', '..');
const indexFile = path.resolve(rootDir, 'index.js');
const iconsDir = path.resolve(rootDir, 'icons');
const iconsJsFile = path.resolve(rootDir, 'icons.js');
const iconsMjsFile = path.resolve(rootDir, 'icons.mjs');
const iconsDtsFile = path.resolve(rootDir, 'icons.d.ts');
const utilsJsFile = path.resolve(rootDir, 'utils.js');
const utilsMjsFile = path.resolve(rootDir, 'utils.mjs');

const templatesDir = path.resolve(__dirname, 'templates');
const indexTemplateFile = path.resolve(templatesDir, 'index.js');
const iconObjectTemplateFile = path.resolve(templatesDir, 'icon-object.js');

const build = async () => {
  const [icons, indexTemplate, iconObjectTemplate, utilsJs] = await Promise.all(
    [
      getIconsData(),
      fs.readFile(indexTemplateFile, UTF8),
      fs.readFile(iconObjectTemplateFile, UTF8),
      fs.readFile(utilsMjsFile, UTF8),
    ],
  );

  // Local helper functions
  const escape = (value) => {
    return value.replace(/(?<!\\)'/g, "\\'");
  };
  const iconToKeyValue = (icon) => {
    return `'${icon.slug}':${iconToObject(icon)}`;
  };
  const licenseToObject = (license) => {
    if (license === undefined) {
      return;
    }

    if (license.url === undefined) {
      license.url = `https://spdx.org/licenses/${license.type}`;
    }
    return license;
  };
  const iconToObject = (icon) => {
    return util.format(
      iconObjectTemplate,
      escape(icon.title),
      escape(icon.slug),
      escape(icon.path),
      escape(icon.source),
      escape(icon.hex),
      icon.guidelines ? `'${escape(icon.guidelines)}'` : undefined,
      licenseToObject(icon.license),
    );
  };
  const writeJs = async (filepath, rawJavaScript) => {
    const { code } = await esbuildTransform(rawJavaScript, {
      minify: true,
      target: 'node14',
    });
    await fs.writeFile(filepath, code);
  };
  const writeTs = async (filepath, rawTypeScript) => {
    await fs.writeFile(filepath, rawTypeScript);
  };

  // 'main'
  const iconsBarrelMjs = [];
  const iconsBarrelJs = [];
  const iconsBarrelDts = [];
  const buildIcons = [];

  await Promise.all(
    icons.map(async (icon) => {
      const filename = getIconSlug(icon);
      const svgFilepath = path.resolve(iconsDir, `${filename}.svg`);
      icon.svg = (await fs.readFile(svgFilepath, UTF8)).replace(/\r?\n/, '');
      icon.path = svgToPath(icon.svg);
      icon.slug = filename;
      buildIcons.push(icon);

      const iconObject = iconToObject(icon);

      const iconExportName = slugToVariableName(icon.slug);

      // add object to the barrel file
      iconsBarrelJs.push(`${iconExportName}:${iconObject},`);
      iconsBarrelMjs.push(`export const ${iconExportName}=${iconObject}`);
      iconsBarrelDts.push(`export const ${iconExportName}:I;`);
    }),
  );

  // write our generic index.js
  const rawIndexJs = util.format(
    indexTemplate,
    buildIcons.map(iconToKeyValue).join(','),
  );
  await writeJs(indexFile, rawIndexJs);

  const svgPropertyDeprecationWarning =
    'The `svg` property will be removed in the next major. Please use `import { getSvg } from "simple-icons/utils"` instead.';
  const iconsJsPrelude = `const d = () => console.warn(${JSON.stringify(
    svgPropertyDeprecationWarning,
  )});`;

  // write our file containing the exports of all icons in CommonJS ...
  const rawIconsJs = `const {getSvg} =require('./utils.js');${iconsJsPrelude}module.exports={${iconsBarrelJs.join(
    '',
  )}};`;
  await writeJs(iconsJsFile, rawIconsJs);
  // and ESM
  const rawIconsMjs = `import {getSvg} from './utils.mjs';${iconsJsPrelude}${iconsBarrelMjs.join(
    '',
  )}`;
  await writeJs(iconsMjsFile, rawIconsMjs);
  // and create a type declaration file
  const rawIconsDts = `import {SimpleIcon} from ".";type I = SimpleIcon;${iconsBarrelDts.join(
    '',
  )}`;
  await writeTs(iconsDtsFile, rawIconsDts);

  await fs.writeFile(
    utilsJsFile,
    (
      await esbuildTransform(utilsJs, {
        format: 'cjs',
        minify: true,
      })
    ).code,
    UTF8,
  );
};

build();
