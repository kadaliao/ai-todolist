// Siri / Shortcuts for the main app target: the Swift file next to this one (the “记一下”
// intent and the App Shortcuts provider) and the localized Siri phrases (AppShortcuts.strings).
// The intent that opens the app lives in targets/widget/_shared (it must be in both targets).
// Siri's ${applicationName} also matches the app's alternative names (INAlternativeAppNames in
// app.json): in Chinese the assistant answers to “小当家”, which Siri hears far more reliably
// than “Docket”.
const fs = require('node:fs');
const path = require('node:path');
const { IOSConfig, withXcodeProject } = require('expo/config-plugins');

const SOURCE = 'DocketShortcuts.swift';

/** Siri's placeholder for the app name, as AppShortcuts.strings spells it. */
const APP = ['$', '{applicationName}'].join('');

/** English phrases are the keys (as written in the Swift file); each must name the app. */
const PHRASES = {
  en: {},
  'zh-Hans': {
    [`Talk to ${APP}`]: `跟${APP}说`,
    [`Tell ${APP}`]: `告诉${APP}`,
    [`Ask ${APP}`]: `问问${APP}`,
    [`Open ${APP} and listen`]: `打开${APP}听我说`,
    [`Add to ${APP}`]: `用${APP}记一下`,
    [`Remember with ${APP}`]: `让${APP}记一下`,
    [`Note in ${APP}`]: `在${APP}里记一下`,
    [`Add a task in ${APP}`]: `在${APP}里加个任务`,
    'Talk to Docket': '跟小当家说',
    'Add to Docket': '让小当家记一下',
  },
};

const quote = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

module.exports = function withAppShortcuts(config) {
  return withXcodeProject(config, (c) => {
    const project = c.modResults;
    const root = c.modRequest.platformProjectRoot;
    const name = IOSConfig.XcodeUtils.getProjectName(c.modRequest.projectRoot);

    fs.copyFileSync(path.join(__dirname, SOURCE), path.join(root, name, SOURCE));
    if (!project.hasFile(`${name}/${SOURCE}`)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: `${name}/${SOURCE}`,
        groupName: name,
        project,
      });
    }

    const supporting = path.join(root, name, 'Supporting');
    for (const [lang, map] of Object.entries(PHRASES)) {
      const dir = path.join(supporting, `${lang}.lproj`);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'AppShortcuts.strings');
      fs.writeFileSync(
        file,
        `${Object.entries(map)
          .map(([k, v]) => `"${quote(k)}" = "${quote(v)}";`)
          .join('\n')}\n`,
      );
      const groupName = `${name}/Supporting/${lang}.lproj`;
      const group = IOSConfig.XcodeUtils.ensureGroupRecursively(project, groupName);
      if (!group?.children.some(({ comment }) => comment === 'AppShortcuts.strings')) {
        IOSConfig.XcodeUtils.addResourceFileToGroup({
          filepath: path.relative(supporting, file),
          groupName,
          project,
          isBuildFile: true,
        });
      }
    }
    return c;
  });
};
