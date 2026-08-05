const lintStagedConfig = {
  '*.{js,mjs,cjs,ts,tsx}': ['eslint --max-warnings=0 --fix', 'prettier --write'],
  '*.{json,md,yml,yaml,css}': 'prettier --write',
};

export default lintStagedConfig;
