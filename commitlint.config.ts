const config = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      [
        "convex",
        "web",
        "auth",
        "providers",
        "connections",
        "slices",
        "ui",
        "deps",
      ],
    ],
  },
};

export default config;
