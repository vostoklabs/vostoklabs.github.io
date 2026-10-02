// Vite `?url` asset imports. The apps get these from `vite/client`; the package typechecks on
// its own, so it declares them.
declare module '*?url' {
  const url: string;
  export default url;
}
