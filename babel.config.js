module.exports = {
  presets: ['@babel/preset-env'],
  // react 包中，单元测试需要转化 jsx
  plugins: [['@babel/plugin-transform-react-jsx', { throwIfNamespace: false }]]
};
