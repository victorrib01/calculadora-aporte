declare module "vitest" {
  export const describe: (...args: any[]) => void;
  export const it: (...args: any[]) => void;
  export const expect: (...args: any[]) => any;
}

declare module "vitest/config" {
  export const defineConfig: (config: any) => any;
}
