// UI テスト用。他担当のファイル編集による HMR の全体リロードでテストが壊れないよう、監視と HMR を切る
export default { root: process.cwd(), server: { hmr: false, watch: null } };
