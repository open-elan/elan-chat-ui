import type { NextConfig } from "next";

const config: NextConfig = {
  // NOTHING CLEVER ON PURPOSE. The example's whole subject is the credential
  // split, and a reader should not have to decide which of these lines is
  // load-bearing.
  reactStrictMode: true,
};

export default config;
