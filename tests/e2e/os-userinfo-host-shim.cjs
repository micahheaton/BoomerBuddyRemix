/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const os = require('node:os');
const { syncBuiltinESMExports } = require('node:module');

const originalUserInfo = os.userInfo;
os.userInfo = (...args) => {
  try {
    return originalUserInfo(...args);
  } catch (error) {
    if (error && error.code === 'ERR_SYSTEM_ERROR') {
      return {
        username: process.env.USERNAME || 'codex',
        uid: -1,
        gid: -1,
        shell: null,
        homedir: process.env.USERPROFILE || process.cwd(),
      };
    }
    throw error;
  }
};

syncBuiltinESMExports();
