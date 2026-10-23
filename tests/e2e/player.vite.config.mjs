// 他担当のファイル編集による HMR リロードでテストが壊れないよう、監視と HMR を切った設定
export default { root: process.cwd(), server: { hmr: false, watch: null } };
