// Node renders component markup without Next.js's CSS loader. The production
// build still checks the styles; these tests only need stable module class names.
require.extensions[".css"] = (module) => {
  module.exports = new Proxy(
    {},
    {
      get: (_target, name) => (name === "__esModule" ? false : name),
    },
  );
};
